import { Command, SourceControlResourceState, SourceControlResourceGroup, SourceControlResourceDecorations, Uri, workspace } from 'vscode';
import { DecorationProvider } from './DecorationProvider';
import { GetStatuses, Status } from './Status';
import { IFileType, GetFileType, FileType } from './FileTypes';


/**
 * An SCM resource represents a state of an underlying workspace resource
 * within a certain SCM provider state.
 *
 * For example, consider file A to be modified. An SCM resource which would
 * represent such state could have the following properties:
 *
 *   - `uri = 'git:workingtree/A'`
 *   - `sourceUri = 'file:A'`
 */
export class Resource implements SourceControlResourceState {
    private _statuses: Status[];
    private _headType: IFileType;

    get uri(): Uri { return this._uri; }
    get resourceUri(): Uri { return this._uri; }
    get decorations(): SourceControlResourceDecorations {
        // TODO Implement
        return DecorationProvider.getDecorations(this._statuses);
    }

    get status(): Status {
        if (this._statuses.length > 0) {
            return this._statuses[0];
        }
        return Status.UNKNOWN;
    }

    get command(): Command {
        const command = workspace.getConfiguration('perforce').get('scmFileChanges') ?
                        'perforce.openResource' :
                        'perforce.openFile';
        return {
            title: 'Open',
            command,
            arguments: [this]
        };
    }

    get change(): string {
        return this._change;
    }

    constructor(private _uri: Uri, private _change: string, action: string, headType?: string) {
        this._statuses = GetStatuses(action);
        this._headType = GetFileType(headType);
    }

    get FileType(): IFileType {
        return this._headType;
    }
}