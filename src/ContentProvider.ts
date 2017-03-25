import { workspace, Uri, Disposable, Event, EventEmitter } from 'vscode';
import { Utils } from './Utils';

export class PerforceContentProvider {
    private onDidChangeEmitter = new EventEmitter<Uri>();
    get onDidChange(): Event<Uri> { return this.onDidChangeEmitter.event; }

    private disposables: Disposable[] = [];
    dispose(): void { this.disposables.forEach(d => d.dispose()); }

    constructor() {
        this.disposables.push(
            workspace.registerTextDocumentContentProvider('perforce', this),
        );
    }

    public provideTextDocumentContent(uri: Uri): Promise<string> {
        let command: string = uri.authority;
        let file: string = uri.fsPath;
        let revision: number = parseInt(uri.fragment);
        let args: string = decodeURIComponent(uri.query);

        return Utils.getOutput(command, file, revision, args);
    }
}