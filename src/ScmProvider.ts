import { scm, commands, window, Uri, Disposable, SourceControl, SourceControlResourceState, SourceControlResourceGroup, Event, EventEmitter, ProviderResult, workspace } from 'vscode';
import { Model } from './scm/Model';
import { Resource } from './scm/Resource';
import { Status } from './scm/Status';
import { mapEvent } from './Utils';
import { FileType } from './scm/FileTypes';
import { IPerforceConfig } from './PerforceService';
import * as Path from 'path';

export class PerforceSCMProvider {
    private compatibilityMode: string;
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
        const total = this._model.ResourceGroups.reduce((r, g) => r + g.resourceStates.length, 0);

        switch (countBadge) {
            case 'off': 
                return 0;
            case 'all':
            default: 
                return total;
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

    constructor(config: IPerforceConfig, compatibilityMode: string) {
        this.compatibilityMode = compatibilityMode;
        this.config = config;
        this.Initialize();
    }

    //TODO: track new workspaceFolder
    //TODO: track closed workspaceFolder

    public Initialize() {
        this._model = new Model(this.config, this.compatibilityMode);

        PerforceSCMProvider.instances.push(this);
        this._model._sourceControl = scm.createSourceControl(this.id, this.label);
        this._model._sourceControl.quickDiffProvider = this;
        this._model._sourceControl.acceptInputCommand = { command: 'perforce.processChangelist', title: 'Process Changelist'};

        // Hook up the model change event to trigger our own event
        this._model.onDidChange(this.onDidModelChange, this, this.disposables);
        this._model.Refresh();

        scm.inputBox.value = '';
    }

    private onDidModelChange(): void {
        this._model._sourceControl.count = this.count;
        commands.executeCommand('setContext', 'perforceState', this.stateContextKey);
    }

    private static GetInstance(): PerforceSCMProvider {
        const perforceProvider = PerforceSCMProvider.instances;
        if (perforceProvider.length === 0) {
            console.log('perforceProvider instance undefined');
        }
        //TODO: support more than just first provider
        return perforceProvider[0];
    }

    public static async OpenFile(resource: Resource): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider.openFile(resource);
    };

    public static async Open(resource: Resource): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider.open(resource);
    };

    public static async Sync(): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Sync();
    };

    public static async Refresh(): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Refresh();
    };

    public static async ProcessChangelist(): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.ProcessChangelist();
    };

    public static async EditChangelist(input: SourceControlResourceGroup): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.EditChangelist(input);
    };

    public static async Describe(input: SourceControlResourceGroup): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Describe(input);
    };

    public static async SubmitDefault(): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.SubmitDefault();
    };
    
    public static async Submit(input?: Resource | SourceControlResourceGroup): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Submit(input);
    };

    public static async Revert(input: Resource | SourceControlResourceGroup): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Revert(input);
    };

    public static async ShelveOrUnshelve(input: Resource): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.ShelveOrUnshelve(input);
    };

    public static async ReopenFile(input: Resource): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.ReopenFile(input);
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

    private open(resource: Resource): void {
        if(resource.FileType.base === FileType.BINARY) {
            const uri = resource.uri.with({ scheme: 'perforce', authority: 'fstat' });
            workspace.openTextDocument(uri)
                .then(doc => window.showTextDocument(doc));
            return;
        }

        const left: Uri = this.getLeftResource(resource);
        const right: Uri = this.getRightResource(resource);
        const title: string = this.getTitle(resource);

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

    private openFile(resource: Resource): void {
        commands.executeCommand<void>("vscode.open", resource.uri);
    }

    // Gets the uri for the previous version of the file.
    private getLeftResource(resource: Resource): Uri | undefined {
        switch (resource.status) {
            case Status.EDIT:
                return resource.uri.with({ scheme: 'perforce', authority: 'print', query: '-q' });
        }
    }

    // Gets the uri for the current version of the file (except for deleted files).
    private getRightResource(resource: Resource): Uri | undefined {
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

    private getTitle(resource: Resource): string {
        const basename = Path.basename(resource.uri.fsPath);

        switch (resource.status) {
            case Status.EDIT:
                return `${basename} - Diff Against Most Recent Revision`;
        }

        return '';
    }

}
