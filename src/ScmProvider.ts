import { commands, scm, window, Uri, Disposable, SourceControl, SourceControlResourceState, SourceControlResourceGroup, Event, EventEmitter, ProviderResult, workspace } from 'vscode';
import { Model } from './scm/Model';
import { Resource } from './scm/Resource';
import { Status } from './scm/Status';
import { mapEvent, Utils } from './Utils';
import { FileType } from './scm/FileTypes';
import { IPerforceConfig, matchConfig } from './PerforceService';
import * as Path from 'path';
import * as fs from 'fs';
import { PerforceCommands } from './PerforceCommands';

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
    }

    private static instances: PerforceSCMProvider[] = [];
    private _model: Model;

    get onDidChange(): Event<this> {
        return mapEvent(this._model.onDidChange, () => this);
    }

    public get resources(): SourceControlResourceGroup[] { return this._model.ResourceGroups; }
    public get id(): string { return 'perforce'; }
    public get label(): string { return 'Perforce'; }
    public get count(): number {
        const countBadge = workspace.getConfiguration('perforce').get<string>('countBadge');
        let statuses = this._model.ResourceGroups.reduce((a, b) => a.concat( b.resourceStates.reduce((c,d) => c.concat( [[(d as Resource).status, (d as Resource).isShelved]] ), [])), []);

        // Don't count MOVE_DELETE as we already count MOVE_ADD
        switch (countBadge) {
            case 'off': 
                return 0;
            case 'all-but-shelved':
                return statuses.filter(s => s[0] !== Status.MOVE_DELETE && !s[1]).length;
            case 'all':
            default: 
                return statuses.filter(s => s[0] !== Status.MOVE_DELETE).length; 
        }
    }

    get sourceControl(): SourceControl {
        return this._model._sourceControl;
    }

    get stateContextKey(): string {
        if (workspace.workspaceFolders == undefined) {
            return 'norepo';
        }

        return 'idle'
    }

    constructor(config: IPerforceConfig, wksFolder: Uri, compatibilityMode: string) {
        this.compatibilityMode = compatibilityMode;
        this.wksFolder = wksFolder;
        this.config = config;
        this.Initialize();
    }

    public Initialize() {
        this._model = new Model(this.config, this.wksFolder, this.compatibilityMode);

        PerforceSCMProvider.instances.push(this);
        this._model._sourceControl = scm.createSourceControl(this.id, this.label, Uri.file(this.config.localDir));
        this._model._sourceControl.quickDiffProvider = this;
        this._model._sourceControl.acceptInputCommand = { command: 'perforce.processChangelist', title: 'Process Changelist', arguments: [this._model._sourceControl]};

        // Hook up the model change event to trigger our own event
        this._model.onDidChange(this.onDidModelChange, this, this.disposables);
        this._model.Refresh();

        this._model._sourceControl.inputBox.value = '';
        this._model._sourceControl.inputBox.placeholder = "Message (press {0} to create changelist)"
    }

    public static registerCommands() {
        
        // SCM commands
        commands.registerCommand('perforce.Refresh', PerforceSCMProvider.Refresh);
        commands.registerCommand('perforce.info', PerforceSCMProvider.Info);
        commands.registerCommand('perforce.Sync', PerforceSCMProvider.Sync);
        commands.registerCommand('perforce.openFile', PerforceSCMProvider.OpenFile);
        commands.registerCommand('perforce.openResource', PerforceSCMProvider.Open);
        commands.registerCommand('perforce.openResourcevShelved', PerforceSCMProvider.OpenvShelved);
        commands.registerCommand('perforce.submitDefault', PerforceSCMProvider.SubmitDefault);
        commands.registerCommand('perforce.processChangelist', PerforceSCMProvider.ProcessChangelist);
        commands.registerCommand('perforce.editChangelist', PerforceSCMProvider.EditChangelist);
        commands.registerCommand('perforce.describe', PerforceSCMProvider.Describe);
        commands.registerCommand('perforce.submitChangelist', PerforceSCMProvider.Submit);
        commands.registerCommand('perforce.revertChangelist', PerforceSCMProvider.Revert);
        commands.registerCommand('perforce.revertUnchangedChangelist', PerforceSCMProvider.RevertUnchanged);
        commands.registerCommand('perforce.shelveChangelist', PerforceSCMProvider.ShelveChangelist);
        commands.registerCommand('perforce.shelveRevertChangelist', PerforceSCMProvider.ShelveRevertChangelist);
        commands.registerCommand('perforce.unshelveChangelist', PerforceSCMProvider.UnshelveChangelist);
        commands.registerCommand('perforce.deleteShelvedChangelist', PerforceSCMProvider.DeleteShelvedChangelist);
        commands.registerCommand('perforce.shelveunshelve', PerforceSCMProvider.ShelveOrUnshelve);
        commands.registerCommand('perforce.revertFile', PerforceSCMProvider.Revert);
        commands.registerCommand('perforce.revertUnchangedFile', PerforceSCMProvider.RevertUnchanged);
        commands.registerCommand('perforce.reopenFile', PerforceSCMProvider.ReopenFile);
    }

    private onDidModelChange(): void {
        this._model._sourceControl.count = this.count;
        commands.executeCommand('setContext', 'perforceState', this.stateContextKey);
    }

    private static GetInstance(uri: Uri | null): PerforceSCMProvider {
        if (!uri) {
            return PerforceSCMProvider.instances ? PerforceSCMProvider.instances[0] : null;
        } else {
            const wksFolder = workspace.getWorkspaceFolder(uri);
            if (wksFolder) {
                for (let provider of PerforceSCMProvider.instances) {
                    if ( matchConfig(provider.config, wksFolder.uri) ) {
                        return provider;
                    }
                }
            }
        }
        return null;
    }

    public static OpenFile(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const preview = selection.length == 1;
        for (const resource of selection) {
            commands.executeCommand<void>("vscode.open", resource.underlyingUri, {preview});
        }
    };

    public static async Open(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(PerforceSCMProvider.open(resource));
        }
        await Promise.all(promises);
    };

    public static async OpenvShelved(...resourceStates: SourceControlResourceState[]) {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        const promises = [];
        for (const resource of selection) {
            promises.push(PerforceSCMProvider.open(resource, DiffType.WORKSPACE_V_SHELVE));
        }
        await Promise.all(promises);
    };

    public static Sync(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl ? sourceControl.rootUri : null);
        perforceProvider._model.Sync();
    };

    public static Refresh(sourceControl: SourceControl) {
        const perforceProvider = PerforceSCMProvider.GetInstance(sourceControl ? sourceControl.rootUri : null);
        perforceProvider._model.Refresh();
    };

    public static RefreshAll() {
        for (let provider of PerforceSCMProvider.instances) {
            provider._model.Refresh();
        }
    };

    public static Info(sourceControl: SourceControl) {
        let provider = PerforceSCMProvider.GetInstance(sourceControl ? sourceControl.rootUri : null);
        provider._model.Info();
    };

    public static ProcessChangelist(sourceControl: SourceControl) {
        let provider = PerforceSCMProvider.GetInstance(sourceControl ? sourceControl.rootUri : null);
        provider._model.ProcessChangelist();
    };

    public static async EditChangelist(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            model.EditChangelist(input);
        }
    };

    public static async Describe(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            model.Describe(input);
        }
    };

    public static async SubmitDefault(sourceControl: SourceControl) {
        let provider = PerforceSCMProvider.GetInstance(sourceControl ? sourceControl.rootUri : null);
        provider._model.SubmitDefault();
    };
    
    public static async Submit(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            model.Submit(input);
        }
    };

    public static async Revert(arg: Resource | SourceControlResourceGroup, ...resourceStates: SourceControlResourceState[]) {
        if (arg instanceof Resource) {
            let resources = [...resourceStates as Resource[], arg as Resource];
            for (const resource of resources) {
                resource.model.Revert(resource);
            }
        } else {
            let group = arg as SourceControlResourceGroup;
            let model: Model = group['model'];
            model.Revert(group);
        }
    };

    public static async RevertUnchanged(arg: Resource | SourceControlResourceGroup, ...resourceStates: SourceControlResourceState[]) {
        if (arg instanceof Resource) {
            let resources = [...resourceStates as Resource[], arg as Resource];
            for (const resource of resources) {
                resource.model.Revert(resource, true);
            }
        } else {
            let group = arg as SourceControlResourceGroup;
            let model: Model = group['model'];
            model.Revert(group, true);
        }
    };

    public static async ShelveChangelist(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            await model.ShelveChangelist(input);
        }
    }

    public static async ShelveRevertChangelist(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            await model.ShelveChangelist(input, true);
        }
    }

    public static async UnshelveChangelist(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            await model.UnshelveChangelist(input);
        }
    }

    public static async DeleteShelvedChangelist(input: SourceControlResourceGroup) {
        let model: Model = input['model'];
        if (model) {
            await model.DeleteShelvedChangelist(input);
        }
    }

    public static async ShelveOrUnshelve(...resourceStates: SourceControlResourceState[]): Promise<void> {
        const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
        for (const resource of selection) {
            resource.model.ShelveOrUnshelve(resource);
        }
    };

    public static async ReopenFile(arg?: Resource | Uri, ...resourceStates: SourceControlResourceState[]): Promise<void> {
        let resources: Resource[] | undefined = undefined;

        if (arg instanceof Uri) {
            // const resource = this.getSCMResource(arg);
            // if (resource !== undefined) {
            //     resources = [resource];
            // }
            console.log('ReopenFile: ' + arg.toString());
            return;
        } else {
            let resource: Resource | undefined = undefined;

            if (arg instanceof Resource) {
                resource = arg;
            } else {
                //resource = this.getSCMResource();
                console.log('ReopenFile: should never happen');
                return;
            }

            if (resource) {
                resources = [...resourceStates as Resource[], resource];
            }
        }

        if (!resources || resources.length == 0) {
            return;
        }

        await resources[0].model.ReopenFile(resources);
    };

    provideOriginalResource(uri: Uri): ProviderResult<Uri> {
        if (uri.scheme !== 'file') {
            return;
        }

        return Utils.makePerforceDocUri(uri, 'print', '-q');
    }


    /**
     * This is the default action when an resource is clicked in the viewlet.
     * For ADD, AND UNDELETE just show the local file.
     * For DELETE just show the server file.
     * For EDIT AND RENAME show the diff window (server on left, local on right).
     */

    private static async open(resource: Resource, diffType?: DiffType): Promise<void> {
        if(resource.FileType.base === FileType.BINARY) {
            const uri = Utils.makePerforceDocUri(resource.resourceUri, 'fstat', '');
            await workspace.openTextDocument(uri)
                .then(doc => window.showTextDocument(doc));
            return;
        }

        if (diffType === undefined) {
            diffType = resource.isShelved ? DiffType.SHELVE_V_DEPOT : DiffType.WORKSPACE_V_DEPOT;
        }

        const left: Uri = PerforceSCMProvider.getLeftResource(resource, diffType);
        const right: Uri = PerforceSCMProvider.getRightResource(resource, diffType);
        const title: string = PerforceSCMProvider.getTitle(resource, diffType);

        if (!left) {
            if (!right) {
                // TODO
                console.error("Status not supported: "+ resource.status.toString() );
                return;
            }
            await commands.executeCommand<void>("vscode.open", right);
            return;
        }
        if (!right) {
            await commands.executeCommand<void>("vscode.open", left);
            return;
        }
        await commands.executeCommand<void>("vscode.diff", left, right, title);
        return;
    }

    // Gets the uri for the previous version of the file.
    private static getLeftResource(resource: Resource, diffType : DiffType): Uri | undefined {
        // the nonce should not be necessary, but sometimes the request seems to continue indefinitely and the promise
        // is never resolved. Subsequently it is impossible to view the diff until the window is closed and re-opened.
        // ideally would find out why the promise doesn't resolve
        const nonce = Math.random().toString();
        const args = {
            depot: resource.isShelved,
            workspace: resource.model.workspaceUri.fsPath,
            nonce
        };
    
        if (diffType === DiffType.WORKSPACE_V_SHELVE) {
            // left hand side is the shelve
            switch(resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.INTEGRATE:
                case Status.MOVE_ADD:
                case Status.BRANCH:
                    return resource.resourceUri.with({ scheme: 'perforce', query: Utils.makePerforceUriQuery('print', '-q', args), fragment: "@=" + resource.change });
                case Status.DELETE:
                case Status.MOVE_DELETE:
            }
        } else {
            const emptyDoc = Uri.parse('perforce:EMPTY');
            // left hand side is the depot version
            switch (resource.status) {
                case Status.ADD:
                case Status.BRANCH:
                    return emptyDoc;
                case Status.MOVE_ADD:
                    // diff against the old file if it is known (always a depot path)
                    return resource.fromFile ? Utils.makePerforceDocUri(resource.fromFile, 'print', '-q', {depot: true, workspace: resource.model.workspaceUri.fsPath, nonce}) : emptyDoc;
                case Status.INTEGRATE:
                case Status.EDIT:
                case Status.DELETE:
                case Status.MOVE_DELETE:
                    return Utils.makePerforceDocUri(resource.resourceUri, 'print', '-q', args);
            }
        }
    }

    // Gets the uri for the current version of the file (or the shelved version depending on the diff type).
    private static getRightResource(resource: Resource, diffType : DiffType): Uri | undefined {
        const emptyDoc = Uri.parse('perforce:EMPTY');
        if (diffType === DiffType.SHELVE_V_DEPOT) {
            const args = {
                depot: resource.isShelved,
                workspace: resource.model.workspaceUri.fsPath,
                nonce: Math.random().toString()
            }

            switch(resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.MOVE_ADD:
                case Status.INTEGRATE:
                case Status.BRANCH:
                    return resource.resourceUri.with({ scheme: 'perforce', query: Utils.makePerforceUriQuery('print', '-q', args), fragment: "@=" + resource.change });
            }
        } else {
            const exists = !resource.isShelved || (resource.underlyingUri && fs.existsSync(resource.underlyingUri.fsPath));
            switch (resource.status) {
                case Status.ADD:
                case Status.EDIT:
                case Status.MOVE_ADD:
                case Status.INTEGRATE:
                case Status.BRANCH:
                    return exists ? resource.underlyingUri ?? emptyDoc :emptyDoc;
            }
        }
    }

    private static getTitle(resource: Resource, diffType : DiffType): string {
        const basename = Path.basename(resource.resourceUri.fsPath);

        let text = '';
        switch (diffType) {
            case DiffType.SHELVE_V_DEPOT:
                text = 'Diff Shelve (right) Against Depot Version (left)';
                break;
            case DiffType.WORKSPACE_V_SHELVE:
                text = 'Diff Workspace (right) Against Shelved Version (left)'
                break;
            case DiffType.WORKSPACE_V_DEPOT:
                text = 'Diff Workspace (right) Against Most Recent Revision (left)'
        }
        return `${basename} - ${text}`
    }

}
