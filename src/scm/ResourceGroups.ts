import { SourceControlResourceGroup, Uri } from "vscode";
import { Resource } from "./Resource";

export class ResourceGroup implements SourceControlResourceGroup {
    get uri(): Uri {
        return Uri.parse(`p4-resource-group:${this.id}`);
    }
    get id(): string {
        return this._id;
    }
    get label(): string {
        return this._label;
    }
    get resourceStates(): Resource[] {
        return this._resources;
    }

    public dispose(): void {
        // not required
    }

    constructor(
        private _id: string,
        private _label: string,
        private _resources: Resource[]
    ) {}
}

export class DefaultGroup extends ResourceGroup {
    static readonly ID = "default";
    static readonly NAME = "Default Changelist";

    constructor(resources: Resource[]) {
        super(DefaultGroup.ID, DefaultGroup.NAME, resources);
    }
}

export class PendingGroup extends ResourceGroup {
    static readonly ID = "pending";
    static readonly NAME = "Pending Changelist";

    constructor(public readonly chnum: number, resources: Resource[]) {
        super(PendingGroup.ID + ":" + chnum, PendingGroup.NAME + " " + chnum, resources);
    }
}

export class ShelvedGroup extends ResourceGroup {
    static readonly ID = "shelved";
    static readonly NAME = "Shelved Changelist";

    constructor(public readonly chnum: number, resources: Resource[]) {
        super(ShelvedGroup.ID + ":" + chnum, ShelvedGroup.NAME + " " + chnum, resources);
    }
}
