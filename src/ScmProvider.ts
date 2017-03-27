import { scm, commands, Uri, Disposable, SCMProvider, SCMResource, SCMResourceGroup, Event, EventEmitter, ProviderResult, workspace } from 'vscode';
import { Model } from './scm/Model';
import { Resource } from './scm/Resource';
import { ResourceGroup } from './scm/ResourceGroups';
import { Status } from './scm/Status';
import * as Path from 'path';

export class PerforceSCMProvider implements SCMProvider {
    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private static instance: PerforceSCMProvider = undefined;
    private _model: Model;


    /* Implement SCMProvider interface */

    private _onDidChange = new EventEmitter<SCMResourceGroup[]>();
    public get onDidChange(): Event<SCMResourceGroup[]> {
        return this._onDidChange.event;
    }

    public get resources(): SCMResourceGroup[] { return this._model.Resources; }
    public get id(): string { return 'perforce'; }
    public get label(): string { return 'Perforce'; }
    public get count(): number {
        return this._model.Resources.reduce((r, g) => r + g.resources.length, 0);
    }

    get state(): string {
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
        this._model.onDidChange((groups: ResourceGroup[]) => this._onDidChange.fire(groups));
        this._model.Refresh();

        PerforceSCMProvider.instance = this;
        scm.registerSCMProvider('perforce', this);

    }

    private static GetInstance(): PerforceSCMProvider {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.instance;
        if (!perforceProvider) {
            console.log('perforceProvider instance undefined');
        }
        return perforceProvider;
    }

    public static async Refresh(): Promise<void> {
        const perforceProvider: PerforceSCMProvider = PerforceSCMProvider.GetInstance();

        await perforceProvider._model.Refresh();
    };

    getOriginalResource(uri: Uri): ProviderResult<Uri> {
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
    open(resource: Resource): ProviderResult<void> {

        const left: Uri = this.getLeftResource(resource);
        const right: Uri = this.getRightResource(resource);
        const title: string = this.getTitle(resource);

        if (!left) {
            if (!right) {
                // TODO
                console.error("Status not supported: "+ resource.status.toString() );
                return;
            }
            return commands.executeCommand<void>("vscode.open", right);
        }
        return commands.executeCommand<void>("vscode.diff", left, right, title);

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
