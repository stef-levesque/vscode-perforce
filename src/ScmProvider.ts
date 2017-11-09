import { scm, commands, window, Uri, Disposable, SourceControl, SourceControlResourceState, SourceControlResourceGroup, Event, EventEmitter, ProviderResult, workspace } from 'vscode';
import { Model } from './scm/Model';
import { Resource } from './scm/Resource';
import { Status } from './scm/Status';
import { mapEvent } from './Utils';
import { FileType } from './scm/FileTypes';
import { IPerforceConfig, matchConfig } from './PerforceService';
import * as Path from 'path';
import { PerforceCommands } from './PerforceCommands';

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
        let statuses = this._model.ResourceGroups.reduce((a, b) => a.concat( b.resourceStates.reduce((c,d) => c.concat( (d as Resource).status ), [])), []);

        // Don't count MOVE_DELETE as we already count MOVE_ADD
        switch (countBadge) {
            case 'off': 
                return 0;
            case 'all-but-shelved':
                return statuses.filter(s => s != Status.SHELVE && s != Status.MOVE_DELETE).length;
            case 'all':
            default: 
                return statuses.filter(s => s != Status.MOVE_DELETE).length; 
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

        scm.inputBox.value = '';
    }

    public static registerCommands() {
        
        // SCM commands
        commands.registerCommand('perforce.Refresh', PerforceSCMProvider.Refresh);
        commands.registerCommand('perforce.info', PerforceSCMProvider.Info);
        commands.registerCommand('perforce.Sync', PerforceSCMProvider.Sync);
        commands.registerCommand('perforce.openFile', PerforceSCMProvider.OpenFile);
        commands.registerCommand('perforce.openResource', PerforceSCMProvider.Open);
        commands.registerCommand('perforce.submitDefault', PerforceSCMProvider.SubmitDefault);
        commands.registerCommand('perforce.processChangelist', PerforceSCMProvider.ProcessChangelist);
        commands.registerCommand('perforce.editChangelist', PerforceSCMProvider.EditChangelist);
        commands.registerCommand('perforce.describe', PerforceSCMProvider.Describe);
        commands.registerCommand('perforce.submitChangelist', PerforceSCMProvider.Submit);
        commands.registerCommand('perforce.revertChangelist', PerforceSCMProvider.Revert);
        commands.registerCommand('perforce.shelveunshelve', PerforceSCMProvider.ShelveOrUnshelve);
        commands.registerCommand('perforce.revertFile', PerforceSCMProvider.Revert);
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

    public static OpenFile(resource: Resource) {
        commands.executeCommand<void>("vscode.open", resource.uri);
    };

    public static Open(resource: Resource) {
        PerforceSCMProvider.open(resource);
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

    public static async Revert(input: Resource | SourceControlResourceGroup) {
        let model: Model = input['model'];
        
        if (model) {
            model.Revert(input);
        }
    };

    public static async ShelveOrUnshelve(input: Resource): Promise<void> {
        input.model.ShelveOrUnshelve(input);
    };

    public static async ReopenFile(input: Resource): Promise<void> {
        input.model.ReopenFile(input);
    };

    provideOriginalResource(uri: Uri): ProviderResult<Uri> {
        if (uri.scheme !== 'file') {
            return;
        }

        return uri.with({ scheme: 'perforce', authority: 'print', query: '-q' });
    }


    /**
     * This is the default action when an resource is clicked in the viewlet.
     * For ADD, AND UNDELETE just show the local file.
     * For DELETE just show the server file.
     * For EDIT AND RENAME show the diff window (server on left, local on right).
     */

    private static open(resource: Resource): void {
        if(resource.FileType.base === FileType.BINARY) {
            const uri = resource.uri.with({ scheme: 'perforce', authority: 'fstat' });
            workspace.openTextDocument(uri)
                .then(doc => window.showTextDocument(doc));
            return;
        }

        const left: Uri = PerforceSCMProvider.getLeftResource(resource);
        const right: Uri = PerforceSCMProvider.getRightResource(resource);
        const title: string = PerforceSCMProvider.getTitle(resource);

        if (!left) {
            if (!right) {
                // TODO
                console.error("Status not supported: "+ resource.status.toString() );
                return;
            }
            commands.executeCommand<void>("vscode.open", right);
            return;
        }
        commands.executeCommand<void>("vscode.diff", left, right, title);
        return;
    }

    // Gets the uri for the previous version of the file.
    private static getLeftResource(resource: Resource): Uri | undefined {
        switch (resource.status) {
            case Status.EDIT:
                return resource.uri.with({ scheme: 'perforce', authority: 'print', query: '-q' });
        }
    }

    // Gets the uri for the current version of the file (except for deleted files).
    private static getRightResource(resource: Resource): Uri | undefined {
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
                return resource.uri;
            case Status.MOVE_DELETE:
            case Status.DELETE:
                return resource.uri.with({ scheme: 'perforce', authority: 'print', query: '-q' });

        }
    }

    private static getTitle(resource: Resource): string {
        const basename = Path.basename(resource.uri.fsPath);

        switch (resource.status) {
            case Status.EDIT:
                return `${basename} - Diff Against Most Recent Revision`;
        }

        return '';
    }

}
