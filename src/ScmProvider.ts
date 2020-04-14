import {
    commands,
    scm,
    window,
    Uri,
    Disposable,
    SourceControl,
    SourceControlResourceState,
    Event,
    workspace,
    TextDocument,
} from "vscode";
import { Model, ResourceGroup } from "./scm/Model";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { mapEvent } from "./Utils";
import { FileType } from "./scm/FileTypes";
import { WorkspaceConfigAccessor } from "./ConfigService";
import * as DiffProvider from "./DiffProvider";
import * as PerforceUri from "./PerforceUri";
import { ClientRoot } from "./extension";
import * as Path from "path";

export class PerforceSCMProvider {
    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        const pos = PerforceSCMProvider.instances.findIndex(
            (instance) => instance === this
        );
        if (pos >= 0) {
            PerforceSCMProvider.instances.splice(pos, 1);
        }
    }

    /**
     * The set of directories that would cause the SCM provider to be created on
     * initialisation, i.e. as a result of initWorkspace and **no other reason**
     * Contains URI fsPath as a string
     */
    private _contributingDirs: Set<string>;
    /**
     * the set of directories that are known to contain contributing *files*
     * just to shortcut the p4 info - if a file is not in a contributingDir but is
     * under a nonContributingDir then it can be added to contributingDocs. Items
     * in this set will not keep the scm provider alive
     */
    private _nonContributingDirs: Set<string>;
    /**
     * the set of text documents that cause the SCM provider to exist and remain
     * active as long as they are open
     */
    private _contributingDocs: Set<TextDocument>;

    private static instances: PerforceSCMProvider[] = [];
    private _model: Model;

    get onDidChange(): Event<this> {
        return mapEvent(this._model.onDidChange, () => this);
    }

    public get resources(): ResourceGroup[] {
        return this._model.ResourceGroups;
    }
    public get id(): string {
        return "perforce";
    }
    public get label(): string {
        return "Perforce";
    }
    public get count(): number {
        const countBadge = this._workspaceConfig.countBadge;
        const resources: Resource[] = this._model.ResourceGroups.flatMap(
            (g) => g.resourceStates as Resource[]
        );

        // Don't count MOVE_DELETE as we already count MOVE_ADD
        switch (countBadge) {
            case "off":
                return 0;
            case "all-but-shelved":
                return resources.filter(
                    (s) => s.status !== Status.MOVE_DELETE && !s.isShelved
                ).length;
            case "all":
            default:
                return resources.filter((s) => s.status !== Status.MOVE_DELETE).length;
        }
    }

    get sourceControl(): SourceControl {
        return this._model._sourceControl;
    }

    get stateContextKey(): string {
        if (workspace.workspaceFolders === undefined) {
            return "norepo";
        }

        return "idle";
    }

    constructor(
        private _clientRoot: ClientRoot,
        private _workspaceConfig: WorkspaceConfigAccessor
    ) {
        this._contributingDirs = new Set<string>();
        this._nonContributingDirs = new Set<string>();
        this._contributingDocs = new Set<TextDocument>();

        const sourceControl = scm.createSourceControl(
            this.id,
            this.label,
            this._clientRoot.clientRoot
        );

        this._model = new Model(
            this._clientRoot.configSource,
            this._clientRoot.clientName,
            this._workspaceConfig,
            sourceControl
        );

        this.disposables.push(this._model, sourceControl);

        PerforceSCMProvider.instances.push(this);
        this._model._sourceControl.quickDiffProvider = this;
        this._model._sourceControl.acceptInputCommand = {
            command: "perforce.processChangelist",
            title: "Process Changelist",
            arguments: [this._model._sourceControl],
        };

        // Hook up the model change event to trigger our own event
        this._model.onDidChange(this.onDidModelChange.bind(this), this, this.disposables);

        this._model._sourceControl.inputBox.value = "";
        this._model._sourceControl.inputBox.placeholder =
            "Message (press {0} to create changelist)";
    }

    public async Initialize() {
        await this._model.RefreshImmediately();
    }

    public addContributingDir(dir: Uri) {
        this._contributingDirs.add(dir.fsPath);
    }

    private isInDir(dir: string, subDir: string) {
        const relative = Path.relative(dir, subDir);
        const isSubdir =
            !relative || (!relative.startsWith("..") && !Path.isAbsolute(relative));
        return isSubdir;
    }

    public removeContributingDirsUnder(dir: Uri) {
        this._contributingDirs.forEach((cd) => {
            if (this.isInDir(dir.fsPath, cd)) {
                this._contributingDirs.delete(cd);
            }
        });
    }

    public addContributingDoc(doc: TextDocument) {
        this._contributingDocs.add(doc);
        this._nonContributingDirs.add(Path.dirname(doc.uri.fsPath));
    }

    public removeContributingDoc(doc: TextDocument): boolean {
        return this._contributingDocs.delete(doc);
    }

    public hasContributingDirFor(doc: TextDocument) {
        for (const dir of this._contributingDirs) {
            if (this.isInDir(dir, doc.uri.fsPath)) {
                return true;
            }
        }
        return false;
    }

    public hasNonContributingDirFor(doc: TextDocument) {
        for (const dir of this._nonContributingDirs) {
            if (this.isInDir(dir, doc.uri.fsPath)) {
                return true;
            }
        }
        return false;
    }

    public checkAndAddContributingDoc(doc: TextDocument): boolean {
        if (this._contributingDocs.has(doc)) {
            return true;
        }
        if (this.hasContributingDirFor(doc)) {
            // don't add - it's the dir that causes it to be added or removed
            return true;
        }
        if (this.hasNonContributingDirFor(doc)) {
            this.addContributingDoc(doc);
            return true;
        }
        return false;
    }

    /**
     * Returns whether or not there are still any contributing documents or workspaces open
     */
    public hasContributors() {
        return this._contributingDirs.size > 0 || this._contributingDocs.size > 0;
    }

    public static checkAndAddContributingDoc(doc: TextDocument): boolean {
        for (const instance of this.instances) {
            if (instance.checkAndAddContributingDoc(doc)) {
                return true;
            }
        }
        return false;
    }

    public static removeContributingDirsUnder(dir: Uri) {
        this.instances.forEach((instance) => instance.removeContributingDirsUnder(dir));
    }

    public static removeContributingDoc(doc: TextDocument): PerforceSCMProvider[] {
        return this.instances.filter((instance) => instance.removeContributingDoc(doc));
    }

    public static disposeInstancesWithoutContributors() {
        const removed = this.instances.filter((instance) => !instance.hasContributors());
        this.instances = this.instances.filter((instance) => instance.hasContributors());

        removed.forEach((r) => r.dispose());
        return removed;
    }

    public static registerCommands() {
        // SCM commands
        commands.registerCommand(
            "perforce.Refresh",
            PerforceSCMProvider.Refresh.bind(this)
        );
        commands.registerCommand("perforce.info", PerforceSCMProvider.Info.bind(this));
        commands.registerCommand("perforce.Sync", PerforceSCMProvider.Sync.bind(this));
        commands.registerCommand(
            "perforce.openFile",
            PerforceSCMProvider.OpenFile.bind(this)
        );
        commands.registerCommand(
            "perforce.openResource",
            PerforceSCMProvider.Open.bind(this)
        );
        commands.registerCommand(
            "perforce.openResourcevShelved",
            PerforceSCMProvider.OpenvShelved.bind(this)
        );
        commands.registerCommand(
            "perforce.submitDefault",
            PerforceSCMProvider.SubmitDefault.bind(this)
        );
        commands.registerCommand(
            "perforce.processChangelist",
            PerforceSCMProvider.ProcessChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.editChangelist",
            PerforceSCMProvider.EditChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.describe",
            PerforceSCMProvider.Describe.bind(this)
        );
        commands.registerCommand(
            "perforce.submitChangelist",
            PerforceSCMProvider.Submit.bind(this)
        );
        commands.registerCommand(
            "perforce.submitSelectedFiles",
            PerforceSCMProvider.SubmitSelectedFiles.bind(this)
        );
        commands.registerCommand(
            "perforce.revertChangelist",
            PerforceSCMProvider.Revert.bind(this)
        );
        commands.registerCommand(
            "perforce.revertUnchangedChangelist",
            PerforceSCMProvider.RevertUnchanged.bind(this)
        );
        commands.registerCommand(
            "perforce.shelveChangelist",
            PerforceSCMProvider.ShelveChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.shelveRevertChangelist",
            PerforceSCMProvider.ShelveRevertChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.unshelveChangelist",
            PerforceSCMProvider.UnshelveChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.deleteShelvedChangelist",
            PerforceSCMProvider.DeleteShelvedChangelist.bind(this)
        );
        commands.registerCommand(
            "perforce.shelveunshelve",
            PerforceSCMProvider.ShelveOrUnshelve.bind(this)
        );
        commands.registerCommand(
            "perforce.deleteShelvedFile",
            PerforceSCMProvider.DeleteShelvedFile.bind(this)
        );
        commands.registerCommand(
            "perforce.revertFile",
            PerforceSCMProvider.Revert.bind(this)
        );
        commands.registerCommand(
            "perforce.revertUnchangedFile",
            PerforceSCMProvider.RevertUnchanged.bind(this)
        );
        commands.registerCommand(
            "perforce.reopenFile",
            PerforceSCMProvider.ReopenFile.bind(this)
        );
        commands.registerCommand(
            "perforce.fixJob",
            PerforceSCMProvider.FixJob.bind(this)
        );
        commands.registerCommand(
            "perforce.unfixJob",
            PerforceSCMProvider.UnfixJob.bind(this)
        );
        commands.registerCommand(
            "perforce.loginScm",
            PerforceSCMProvider.Login.bind(this)
        );
        commands.registerCommand(
            "perforce.logoutScm",
            PerforceSCMProvider.Logout.bind(this)
        );
    }

    private onDidModelChange(): void {
        this._model._sourceControl.count = this.count;
        commands.executeCommand("setContext", "perforceState", this.stateContextKey);
    }

    private static isSourceControl(arg: any): arg is SourceControl {
        return arg && arg.inputBox;
    }

    private static GetInstance(
        sourceControl?: SourceControl | undefined
    ): PerforceSCMProvider | undefined {
        if (!this.isSourceControl(sourceControl)) {
            return PerforceSCMProvider.instances?.[0];
        }
        return this.instances.find(
            (instance) => instance.sourceControl === sourceControl
        );
    }

    static isSameClient(a: ClientRoot, b: ClientRoot) {
        return (
            a.clientName === b.clientName &&
            a.clientRoot.fsPath === b.clientRoot.fsPath &&
            a.userName === b.userName &&
            a.serverAddress === b.serverAddress
        );
    }

    public static GetInstanceByClient(clientRoot: ClientRoot) {
        // TODO
        return this.instances.find((instance) =>
            this.isSameClient(instance._clientRoot, clientRoot)
        );
    }

    public static async Login(sourceControl?: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl);
        await perforceProvider?._model.Login();
    }

    public static async Logout(sourceControl?: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl);
        await perforceProvider?._model.Logout();
    }

    public static async OpenFile(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        const preview = selection.length === 1;
        const promises = selection.map((resource) => {
            return commands.executeCommand<void>("vscode.open", resource.resourceUri, {
                preview,
            });
        });

        await Promise.all(promises);
    }

    public static async Open(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(PerforceSCMProvider.open(resource));
        }
        await Promise.all(promises);
    }

    public static async OpenvShelved(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(
                PerforceSCMProvider.open(
                    resource,
                    DiffProvider.DiffType.WORKSPACE_V_SHELVE
                )
            );
        }
        await Promise.all(promises);
    }

    public static Sync(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl);
        perforceProvider?._model.Sync();
    }

    public static async Refresh(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl);
        await perforceProvider?._model.RefreshPolitely();
    }

    public static async RefreshAll() {
        const promises = PerforceSCMProvider.instances.map((provider) =>
            provider._model.Refresh()
        );
        await Promise.all(promises);
    }

    public static Info(sourceControl: SourceControl) {
        const provider = PerforceSCMProvider.GetInstance(sourceControl);
        provider?._model.Info();
    }

    public static async ProcessChangelist(sourceControl: SourceControl) {
        const provider = PerforceSCMProvider.GetInstance(sourceControl);
        await provider?._model.ProcessChangelist();
    }

    public static async EditChangelist(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.EditChangelist(input);
        }
    }

    public static async Describe(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.Describe(input);
        }
    }

    public static async SubmitDefault(sourceControl: SourceControl) {
        const provider = PerforceSCMProvider.GetInstance(sourceControl);
        await provider?._model.SubmitDefault();
    }

    public static async Submit(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.Submit(input);
        }
    }

    public static async SubmitSelectedFiles(
        ...resourceStates: SourceControlResourceState[]
    ) {
        const resources = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        await resources[0].model.SubmitSelectedFile(resources);
    }

    public static async Revert(
        arg: Resource | ResourceGroup,
        ...resourceStates: SourceControlResourceState[]
    ) {
        if (arg instanceof Resource) {
            const resources = [...(resourceStates as Resource[]), arg];
            const promises = resources.map((resource) => resource.model.Revert(resource));
            await Promise.all(promises);
        } else {
            const group = arg;
            const model: Model = group.model;
            await model.Revert(group);
        }
    }

    public static async RevertUnchanged(
        arg: Resource | ResourceGroup,
        ...resourceStates: SourceControlResourceState[]
    ) {
        if (arg instanceof Resource) {
            const resources = [...(resourceStates as Resource[]), arg];
            const promises = resources.map((resource) =>
                resource.model.Revert(resource, true)
            );
            await Promise.all(promises);
        } else {
            const group = arg;
            const model: Model = group.model;
            await model.Revert(group, true);
        }
    }

    public static async ShelveChangelist(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.ShelveChangelist(input);
        }
    }

    public static async ShelveRevertChangelist(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.ShelveChangelist(input, true);
        }
    }

    public static async UnshelveChangelist(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.UnshelveChangelist(input);
        }
    }

    public static async DeleteShelvedChangelist(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.DeleteShelvedChangelist(input);
        }
    }

    public static async ShelveOrUnshelve(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        const selection = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        const promises = selection.map((resource) =>
            resource.model.ShelveOrUnshelve(resource)
        );
        await Promise.all(promises);
    }

    public static async DeleteShelvedFile(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        const selection = resourceStates.filter(
            (s) => s instanceof Resource
        ) as Resource[];
        const promises = selection.map((resource) =>
            resource.model.DeleteShelvedFile(resource)
        );
        await Promise.all(promises);
    }

    public static async ReopenFile(
        arg?: Resource | Uri,
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        let resources: Resource[] | undefined = undefined;

        if (arg instanceof Uri) {
            // const resource = this.getSCMResource(arg);
            // if (resource !== undefined) {
            //     resources = [resource];
            // }
            console.log("ReopenFile: " + arg.toString());
            return;
        } else {
            let resource: Resource | undefined = undefined;

            if (arg instanceof Resource) {
                resource = arg;
            } else {
                //resource = this.getSCMResource();
                console.log("ReopenFile: should never happen");
                return;
            }

            if (resource) {
                resources = [...(resourceStates as Resource[]), resource];
            }
        }

        if (!resources || resources.length === 0) {
            return;
        }

        await resources[0].model.ReopenFile(resources);
    }

    public static async FixJob(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.FixJob(input);
        }
    }

    public static async UnfixJob(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.UnfixJob(input);
        }
    }

    async provideOriginalResource(uri: Uri): Promise<Uri | undefined> {
        if (uri.scheme !== "file") {
            return;
        }

        // for a MOVE operation, diff against the original file
        const resource = this._model.getOpenResource(uri);

        if (
            resource &&
            resource.status === Status.MOVE_ADD &&
            resource.fromFile &&
            resource.fromEndRev
        ) {
            return resource.fromFile;
        }

        //otherwise diff against the have revision
        if (await this._model.haveFile(uri)) {
            return PerforceUri.fromUriWithRevision(uri, "have");
        }
    }

    public static hasOpenFile(uri: Uri) {
        return this.instances.some((inst) => inst._model.getOpenResource(uri));
    }

    public static mayHaveConflictForFile(uri: Uri) {
        return this.instances.some((inst) => inst._model.mayHaveConflictForFile(uri));
    }

    private static async open(
        resource: Resource,
        diffType?: DiffProvider.DiffType
    ): Promise<void> {
        if (resource.FileType.base === FileType.BINARY) {
            const uri = PerforceUri.fromUri(resource.resourceUri, { command: "fstat" });
            await workspace
                .openTextDocument(uri)
                .then((doc) => window.showTextDocument(doc));
            return;
        }

        await DiffProvider.diffDefault(resource, diffType);
    }
}
