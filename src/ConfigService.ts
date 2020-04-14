import { Uri, workspace } from "vscode";

export enum HideNonWorkspace {
    SHOW_ALL,
    HIDE_FILES,
    HIDE_CHANGELISTS,
}

export class ConfigAccessor {
    constructor() {
        /**/
    }

    private getConfigItem<T>(item: string): T | undefined {
        return workspace.getConfiguration("perforce").get<T>(item);
    }

    public get changelistOrder(): string {
        return this.getConfigItem("changelistOrder") ?? "descending";
    }

    public get ignoredChangelistPrefix(): string | undefined {
        return this.getConfigItem("ignoredChangelistPrefix");
    }

    public get hideNonWorkspaceFiles(): HideNonWorkspace {
        const val = this.getConfigItem("hideNonWorkspaceFiles");
        if (typeof val === "boolean") {
            return val ? HideNonWorkspace.HIDE_FILES : HideNonWorkspace.SHOW_ALL;
        } else if (typeof val === "string") {
            if (val === "show all files") {
                return HideNonWorkspace.SHOW_ALL;
            }
            if (val.startsWith("hide changelists")) {
                return HideNonWorkspace.HIDE_CHANGELISTS;
            }
            if (val.startsWith("show all changelists")) {
                return HideNonWorkspace.HIDE_FILES;
            }
        }
        return HideNonWorkspace.SHOW_ALL;
    }

    public get hideEmptyChangelists(): boolean {
        return this.getConfigItem("hideEmptyChangelists") ?? false;
    }

    public get hideShelvedFiles(): boolean {
        return this.getConfigItem("hideShelvedFiles") ?? false;
    }

    public get maxFilePerCommand(): number {
        return this.getConfigItem("maxFilePerCommand") ?? 32;
    }

    public get countBadge(): string {
        return this.getConfigItem<string>("countBadge") ?? "all-but-shelved";
    }

    public get promptBeforeSubmit(): boolean {
        return this.getConfigItem("promptBeforeSubmit") ?? false;
    }

    public get refreshDebounceTime(): number {
        return 1000;
    }

    public get editOnFileSave(): boolean {
        return this.getConfigItem("editOnFileSave") ?? false;
    }

    public get editOnFileModified(): boolean {
        return this.getConfigItem("editOnFileModified") ?? false;
    }

    public get addOnFileCreate(): boolean {
        return this.getConfigItem("addOnFileCreate") ?? false;
    }

    public get deleteOnFileDelete(): boolean {
        return this.getConfigItem("deleteOnFileDelete") ?? false;
    }

    public get swarmHost(): string | undefined {
        return this.getConfigItem("swarmHost");
    }

    public getSwarmLink(chnum: string): string | undefined {
        const host = this.swarmHost;
        if (!host) {
            return undefined;
        }
        if (host.includes("${chnum}")) {
            return host.replace("${chnum}", chnum);
        }
        return host + "/changes/" + chnum;
    }
}

export class WorkspaceConfigAccessor extends ConfigAccessor {
    constructor(private _workspaceUri: Uri) {
        super();
    }

    private getWorkspaceConfigItem<T>(item: string): T | undefined {
        return workspace.getConfiguration("perforce", this._workspaceUri).get<T>(item);
    }

    public get pwdOverride(): string | undefined {
        return this.getWorkspaceConfigItem("dir");
    }
}
