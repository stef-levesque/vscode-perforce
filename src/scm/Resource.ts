import {
    Command,
    SourceControlResourceState,
    SourceControlResourceDecorations,
    Uri,
    workspace
} from "vscode";
import { DecorationProvider } from "./DecorationProvider";
import { GetStatuses, Status } from "./Status";
import { IFileType, GetFileType } from "./FileTypes";
import { Model, FstatInfo } from "./Model";
import { Utils } from "../Utils";

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
    private _resourceUri: Uri;
    private _fromFile?: Uri;
    private _fromEndRev?: string;

    /**
     * The working revision of the file if open (it should be)
     *
     * This is normally the same as the have revision, but a shelved file
     * might have a different working revision
     */
    private _workingRevision: string;

    /**
     * URI is always a depot path stored as a URI (depot paths are not really URIs, but it is close enough,
     * and the SourceControlResourceState requires this property to be a URI)
     *
     * You **must not** use fsPath on this URI to get a depot path - this does not work on windows.
     * Use the `depotPath` property instead.
     */
    get uri(): Uri {
        return this._uri;
    }
    /**
     * Resource URI *should* be the underlying file, but for shelved files, a depot path is used
     *
     * this keeps them together in the workspace tree, and for some operations there may not be a matching file in the workspace
     */
    get resourceUri(): Uri {
        return this._resourceUri;
    }
    get decorations(): SourceControlResourceDecorations {
        return DecorationProvider.getDecorations(this._statuses, this._isShelved);
    }
    /**
     * The underlying URI is always the workspace path, where it is known, or undefined otherwise
     */
    get underlyingUri(): Uri | undefined {
        return this._underlyingUri;
    }
    /**
     * A string representation of the depot path - this is needed because, on windows, the fsPath turns into backslashes
     */
    get depotPath(): string {
        return Utils.getDepotPathFromDepotUri(this._uri);
    }
    /**
     * The base file from which this file is pending integration - a depot path as a URI
     *
     * You **must not** use fsPath on this URI to get a depot path - this does not work on windows.
     * Use `Utils.getDepotPathFromDepotUri` instead
     */
    get fromFile(): Uri | undefined {
        return this._fromFile;
    }

    get fromEndRev(): string | undefined {
        return this._fromEndRev;
    }

    get status(): Status {
        if (this._statuses.length > 0) {
            return this._statuses[0];
        }
        return Status.UNKNOWN;
    }

    get command(): Command {
        const command = workspace.getConfiguration("perforce").get("scmFileChanges")
            ? "perforce.openResource"
            : "perforce.openFile";
        return {
            title: "Open",
            command,
            arguments: [this]
        };
    }

    get change(): string {
        return this._change;
    }

    get workingRevision(): string {
        return this._workingRevision;
    }

    constructor(
        public model: Model,
        private _uri: Uri,
        private _underlyingUri: Uri | undefined,
        private _change: string,
        private _isShelved: boolean,
        action: string,
        fstatInfo: FstatInfo,
        headType?: string
    ) {
        this._statuses = GetStatuses(action);
        if (this._isShelved) {
            // force a depot-like path as the resource URI, to sort them together in the tree
            this._resourceUri = _uri;
        } else {
            if (!_underlyingUri) {
                throw new Error(
                    "Files in the local workspace must have an underlying URI"
                );
            }
            this._resourceUri = _underlyingUri;
        }
        if (fstatInfo["resolveFromFile0"]) {
            this._fromFile = Uri.file(fstatInfo["resolveFromFile0"]);
        }
        this._fromEndRev = fstatInfo["resolveEndFromRev0"];

        this._workingRevision = fstatInfo["workRev"] ?? fstatInfo["haveRev"] ?? "have"; // (files opened for branch probably have a workRev but no haveRev)
        this._headType = GetFileType(headType);
    }

    get isShelved(): boolean {
        return this._isShelved;
    }

    get FileType(): IFileType {
        return this._headType;
    }
}
