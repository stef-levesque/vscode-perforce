import { Uri, workspace } from "vscode";

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

    public get hideNonWorkspaceFiles(): boolean {
        return this.getConfigItem("hideNonWorkspaceFiles") ?? false;
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
