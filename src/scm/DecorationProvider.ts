import { SCMResourceDecorations, Uri } from 'vscode';
import { Status } from './Status';
import * as path from 'path';

export class DecorationProvider {
    private static _iconsRootPath: string = path.join(path.dirname(__dirname), '..', '..', 'resources', 'icons');

    public static getDecorations(statuses: Status[]): SCMResourceDecorations {
        const status: Status = this.getDominantStatus(statuses);
        const light = { iconPath: DecorationProvider.getIconPath(status, 'light') };
        const dark = { iconPath: DecorationProvider.getIconPath(status, 'dark') };

        return { strikeThrough: DecorationProvider.useStrikeThrough(status), light, dark };
    }

    private static getDominantStatus(statuses: Status[]) {
        if (!statuses || statuses.length === 0) {
            return undefined;
        }

        // if there's only one just return it
        if (statuses.length === 1) {
            return statuses[0];
        }

        // The most dominant types are ADD, EDIT, and DELETE
        let index: number = statuses.findIndex((s) => s === Status.ADD || s === Status.EDIT || s === Status.DELETE);
        if (index >= 0) {
            return statuses[index];
        }

        // The next dominant type is MOVE
        index = statuses.findIndex((s) => s === Status.MOVE_ADD || s === Status.MOVE_DELETE);
        if (index >= 0) {
            return statuses[index];
        }

        // After that, just return the first one
        return statuses[0];
    }

    private static getIconUri(iconName: string, theme: string): Uri {
        return Uri.file(path.join(DecorationProvider._iconsRootPath, theme, `${iconName}.svg`));
    }

    private static getIconPath(status: Status, theme: string): Uri | undefined {
        switch (status) {
            case Status.ADD: return DecorationProvider.getIconUri('status-add', theme);
            case Status.ARCHIVE: return DecorationProvider.getIconUri('status-archive', theme);
            case Status.BRANCH: return DecorationProvider.getIconUri('status-branch', theme);
            case Status.DELETE: return DecorationProvider.getIconUri('status-delete', theme);
            case Status.EDIT: return DecorationProvider.getIconUri('status-edit', theme);
            case Status.IMPORT: return DecorationProvider.getIconUri('status-integrate', theme);
            case Status.INTEGRATE: return DecorationProvider.getIconUri('status-integrate', theme);
            case Status.LOCK: return DecorationProvider.getIconUri('status-lock', theme);
            case Status.MOVE_ADD: return DecorationProvider.getIconUri('status-move', theme);
            case Status.MOVE_DELETE: return DecorationProvider.getIconUri('status-move', theme);
            case Status.PURGE: return DecorationProvider.getIconUri('status-delete', theme);
            default: return void 0;
        }
    }

    private static useStrikeThrough(status: Status): boolean {
        return (status === Status.DELETE) || status === Status.MOVE_DELETE;
    }
}
