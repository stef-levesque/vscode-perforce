import { scm, commands, window, Uri, Disposable, SourceControl, SourceControlResourceState, SourceControlResourceGroup, Event, EventEmitter, ProviderResult, workspace } from 'vscode';
import { Model } from './scm/Model';
import { Resource } from './scm/Resource';
import { Status } from './scm/Status';
import * as Path from 'path';

export class PerforceSCMProvider {
    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private static instance: PerforceSCMProvider = undefined;
    private _model: Model;

    private _onDidChange = new EventEmitter<this>();
    public get onDidChange(): Event<this> {
        return this._onDidChange.event;
    }

    public get resources(): SourceControlResourceGroup[] { return this._model.ResourceGroups; }
    public get id(): string { return 'perforce'; }
    public get label(): string { return 'Perforce'; }
    public get count(): number {
        return this._model.ResourceGroups.reduce((r, g) => r + g.resourceStates.length, 0);
    }

    get sourceControl(): SourceControl {
        return this._model._sourceControl;
    }

    get stateContextKey(): string {
        if (workspace.rootPath == undefined) {
            return 'norepo';
        }

        return 'idle'
    }

    constructor() {
        this.Initialize();
    }

    public Initialize() {
        this._model = new Model();
        // Hook up the model change event to trigger our own event
        this._model.onDidChange((groups: SourceControlResourceGroup[]) => this._onDidChange.fire(this));
        this._model.Refresh();

        PerforceSCMProvider.instance = this;
        this._model._sourceControl = scm.createSourceControl(this.id, this.label);
        this._model._sourceControl.quickDiffProvider = this;
        this._model._sourceControl.acceptInputCommand = { command: 'perforce.submitChangelist', title: 'Submit Changelist'};

        scm.inputBox.value = "";

    }

    private static GetInstance(): PerforceSCMProvider {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.instance;
        if (!perforceProvider) {
            console.log('perforceProvider instance undefined');
        }
        return perforceProvider;
    }

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

    public static async Submit(input?: Resource | SourceControlResourceGroup): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Submit(input);
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
