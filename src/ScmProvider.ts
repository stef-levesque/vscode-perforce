import {
    commands,
    scm,
    window,
    Uri,
    Disposable,
    SourceControl,
    SourceControlResourceState,
    Event,
    ProviderResult,
    workspace
} from "vscode";
import { Model, ResourceGroup } from "./scm/Model";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { mapEvent, Utils } from "./Utils";
import { FileType } from "./scm/FileTypes";
import { IPerforceConfig, matchConfig } from "./PerforceService";
import * as Path from "path";
import * as fs from "fs";
import { WorkspaceConfigAccessor } from "./ConfigService";

enum DiffType {
    WORKSPACE_V_DEPOT,
    SHELVE_V_DEPOT,
    WORKSPACE_V_SHELVE
}

export class PerforceSCMProvider {
    private compatibilityMode: string;
    private wksFolder: Uri;
    private config: IPerforceConfig;

    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        const pos = PerforceSCMProvider.instances.findIndex(
            instance => instance === this
        );
        if (pos >= 0) {
            PerforceSCMProvider.instances.splice(pos, 1);
        }
    }

    private static instances: PerforceSCMProvider[] = [];
    private _model: Model;

    get onDidChange(): Event<this> {
        return mapEvent(this._model.onDidChange, () => this);
    }

    get onRefreshStarted(): Event<this> {
        return mapEvent(this._model.onRefreshStarted, () => this);
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
        const resources: Resource[] = this._model.ResourceGroups.reduce(
            (a, b) => a.concat(b.resourceStates as Resource[]),
            [] as Resource[]
        );

        // Don't count MOVE_DELETE as we already count MOVE_ADD
        switch (countBadge) {
            case "off":
                return 0;
            case "all-but-shelved":
                return resources.filter(
                    s => s.status !== Status.MOVE_DELETE && !s.isShelved
                ).length;
            case "all":
            default:
                return resources.filter(s => s.status !== Status.MOVE_DELETE).length;
        }
    }

    get sourceControl(): SourceControl {
        return this._model._sourceControl;
    }

    get stateContextKey(): string {
        if (workspace.workspaceFolders == undefined) {
            return "norepo";
        }

        return "idle";
    }

    constructor(
        config: IPerforceConfig,
        wksFolder: Uri,
        private _workspaceConfig: WorkspaceConfigAccessor,
        compatibilityMode: string
    ) {
        this.compatibilityMode = compatibilityMode;
        this.wksFolder = wksFolder;
        this.config = config;

        this._model = new Model(
            this.config,
            this.wksFolder,
            this._workspaceConfig,
            this.compatibilityMode,
            scm.createSourceControl(this.id, this.label, Uri.file(this.config.localDir))
        );

        this.disposables.push(this._model);

        PerforceSCMProvider.instances.push(this);
        this._model._sourceControl.quickDiffProvider = this;
        this._model._sourceControl.acceptInputCommand = {
            command: "perforce.processChangelist",
            title: "Process Changelist",
            arguments: [this._model._sourceControl]
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
    }

    private onDidModelChange(): void {
        this._model._sourceControl.count = this.count;
        commands.executeCommand("setContext", "perforceState", this.stateContextKey);
    }

    private static GetInstance(uri?: Uri | null): PerforceSCMProvider | null {
        if (!uri) {
            return PerforceSCMProvider.instances
                ? PerforceSCMProvider.instances[0]
                : null;
        } else {
            const wksFolder = workspace.getWorkspaceFolder(uri);
            if (wksFolder) {
                for (const provider of PerforceSCMProvider.instances) {
                    if (matchConfig(provider.config, wksFolder.uri)) {
                        return provider;
                    }
                }
            }
        }
        return null;
    }

    public static async OpenFile(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const preview = selection.length == 1;
        const promises = selection.map(resource => {
            return commands.executeCommand<void>("vscode.open", resource.underlyingUri, {
                preview
            });
        });

        await Promise.all(promises);
    }

    public static async Open(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(PerforceSCMProvider.open(resource));
        }
        await Promise.all(promises);
    }

    public static async OpenvShelved(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(
                PerforceSCMProvider.open(resource, DiffType.WORKSPACE_V_SHELVE)
            );
        }
        await Promise.all(promises);
    }

    public static Sync(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(
            sourceControl ? sourceControl.rootUri : null
        );
        perforceProvider?._model.Sync();
    }

    public static async Refresh(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(
            sourceControl ? sourceControl.rootUri : null
        );
        await perforceProvider?._model.RefreshPolitely();
    }

    public static async RefreshAll() {
        const promises = PerforceSCMProvider.instances.map(provider =>
            provider._model.Refresh()
        );
        await Promise.all(promises);
    }

    public static Info(sourceControl: SourceControl) {
        const provider = PerforceSCMProvider.GetInstance(
            sourceControl ? sourceControl.rootUri : null
        );
        provider?._model.Info();
    }

    public static async ProcessChangelist(sourceControl: SourceControl) {
        const provider = PerforceSCMProvider.GetInstance(
            sourceControl ? sourceControl.rootUri : null
        );
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
        const provider = PerforceSCMProvider.GetInstance(
            sourceControl ? sourceControl.rootUri : null
        );
        await provider?._model.SubmitDefault();
    }

    public static async Submit(input: ResourceGroup) {
        const model: Model = input.model;
        if (model) {
            await model.Submit(input);
        }
    }

    public static async Revert(
        arg: Resource | ResourceGroup,
        ...resourceStates: SourceControlResourceState[]
    ) {
        if (arg instanceof Resource) {
            const resources = [...(resourceStates as Resource[]), arg];
            const promises = resources.map(resource => resource.model.Revert(resource));
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
            const promises = resources.map(resource =>
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
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const promises = selection.map(resource =>
            resource.model.ShelveOrUnshelve(resource)
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

        if (!resources || resources.length == 0) {
            return;
        }

        await resources[0].model.ReopenFile(resources);
    }

    provideOriginalResource(uri: Uri): ProviderResult<Uri> {
        if (uri.scheme !== "file") {
            return;
        }

        return Utils.makePerforceDocUri(uri, "print", "-q");
    }

    /**
     * This is the default action when an resource is clicked in the viewlet.
     * For ADD, AND UNDELETE just show the local file.
     * For DELETE just show the server file.
     * For EDIT AND RENAME show the diff window (server on left, local on right).
     */

    private static async open(resource: Resource, diffType?: DiffType): Promise<void> {
        if (resource.FileType.base === FileType.BINARY) {
            const uri = Utils.makePerforceDocUri(resource.resourceUri, "fstat", "");
            await workspace
                .openTextDocument(uri)
                .then(doc => window.showTextDocument(doc));
            return;
        }

        if (diffType === undefined) {
            diffType = resource.isShelved
                ? DiffType.SHELVE_V_DEPOT
                : DiffType.WORKSPACE_V_DEPOT;
        }

        const left = PerforceSCMProvider.getLeftResource(resource, diffType);
        const right = PerforceSCMProvider.getRightResource(resource, diffType);
        const title: string = PerforceSCMProvider.getTitle(resource, diffType);

        if (!left) {
            if (!right) {
                // TODO
                console.error("Status not supported: " + resource.status.toString());
                return;
            }
            await window.showTextDocument(right);
            return;
        }
        if (!right) {
            await window.showTextDocument(left);
            return;
        }
        await commands.executeCommand<void>("vscode.diff", left, right, title);
        return;
    }

    // Gets the uri for the previous version of the file.
    private static getLeftResource(
        resource: Resource,
        diffType: DiffType
    ): Uri | undefined {
        const args = {
            depot: resource.isShelved,
            workspace: resource.model.workspaceUri.fsPath
        };

        if (diffType === DiffType.WORKSPACE_V_SHELVE) {
            // left hand side is the shelve
            switch (resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.INTEGRATE:
                case Status.MOVE_ADD:
                case Status.BRANCH:
                    return resource.resourceUri.with({
                        scheme: "perforce",
                        query: Utils.makePerforceUriQuery("print", "-q", args),
                        fragment: "@=" + resource.change
                    });
                case Status.DELETE:
                case Status.MOVE_DELETE:
            }
        } else {
            const emptyDoc = Uri.parse("perforce:EMPTY");
            // left hand side is the depot version
            switch (resource.status) {
                case Status.ADD:
                case Status.BRANCH:
                    return emptyDoc;
                case Status.MOVE_ADD:
                    // diff against the old file if it is known (always a depot path)
                    return resource.fromFile
                        ? Utils.makePerforceDocUri(resource.fromFile, "print", "-q", {
                              depot: true,
                              workspace: resource.model.workspaceUri.fsPath
                          })
                        : emptyDoc;
                case Status.INTEGRATE:
                case Status.EDIT:
                case Status.DELETE:
                case Status.MOVE_DELETE:
                    return Utils.makePerforceDocUri(
                        resource.resourceUri,
                        "print",
                        "-q",
                        args
                    );
            }
        }
    }

    // Gets the uri for the current version of the file (or the shelved version depending on the diff type).
    private static getRightResource(
        resource: Resource,
        diffType: DiffType
    ): Uri | undefined {
        const emptyDoc = Uri.parse("perforce:EMPTY");
        if (diffType === DiffType.SHELVE_V_DEPOT) {
            const args = {
                depot: resource.isShelved,
                workspace: resource.model.workspaceUri.fsPath
            };

            switch (resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.MOVE_ADD:
                case Status.INTEGRATE:
                case Status.BRANCH:
                    return resource.resourceUri.with({
                        scheme: "perforce",
                        query: Utils.makePerforceUriQuery("print", "-q", args),
                        fragment: "@=" + resource.change
                    });
            }
        } else {
            const exists =
                !resource.isShelved ||
                (resource.underlyingUri && fs.existsSync(resource.underlyingUri.fsPath));
            switch (resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.MOVE_ADD:
                case Status.INTEGRATE:
                case Status.BRANCH:
                    return exists ? resource.underlyingUri ?? emptyDoc : emptyDoc;
            }
        }
    }

    private static getTitle(resource: Resource, diffType: DiffType): string {
        const basename = Path.basename(resource.resourceUri.fsPath);

        let text = "";
        switch (diffType) {
            case DiffType.SHELVE_V_DEPOT:
                text = "Diff Shelve (right) Against Depot Version (left)";
                break;
            case DiffType.WORKSPACE_V_SHELVE:
                text = "Diff Workspace (right) Against Shelved Version (left)";
                break;
            case DiffType.WORKSPACE_V_DEPOT:
                text = "Diff Workspace (right) Against Most Recent Revision (left)";
        }
        return `${basename} - ${text}`;
    }
}
