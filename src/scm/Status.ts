export function GetStatuses(statusText: string): Status[] {
    let result: Status[] = [];
    if (!statusText) {
        return result;
    }

    const statusStrings: string[] = statusText.split(",");
    for (let i: number = 0; i < statusStrings.length; i++) {
        switch (statusStrings[i].trim().toLowerCase()) {
            case "add": result.push(Status.ADD); break;
            case "archive": result.push(Status.ARCHIVE); break;
            case "branch": result.push(Status.BRANCH); break;
            case "delete": result.push(Status.DELETE); break;
            case "edit": result.push(Status.EDIT); break;
            case "integrate": result.push(Status.INTEGRATE); break;
            case "import": result.push(Status.IMPORT); break;
            case "lock": result.push(Status.LOCK); break;
            case "move/add": result.push(Status.MOVE_ADD); break;
            case "move/delete": result.push(Status.MOVE_DELETE); break;
            case "purge": result.push(Status.PURGE); break;
            default:
                result.push(Status.UNKNOWN); break;
        }
    }

    return result;
}

export enum Status {
    ADD,
    ARCHIVE,
    BRANCH,
    DELETE,
    EDIT,
    IMPORT,
    INTEGRATE,
    LOCK,
    MOVE_ADD,
    MOVE_DELETE,
    PURGE,
    UNKNOWN
}
