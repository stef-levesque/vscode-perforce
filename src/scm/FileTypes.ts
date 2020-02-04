export enum FileType {
    UNKNOWN,
    TEXT,
    BINARY,
    SYMLINK,
    APPLE,
    RESOURCE,
    UNICODE,
    UTF8,
    UTF16
}

export enum Modifiers {
    NONE = 0,
    WRITABLE = 1 << 0,
    EXECUTE = 1 << 1,
    RCS_KEYWORD_EXPANSION = 1 << 2,
    EXCLUSIVE_OPEN = 1 << 3,
    STOREREV_FULL_COMPRESSED = 1 << 4,
    STOREREV_RSC_DELTA = 1 << 5,
    STOREREV_FULL_FILE = 1 << 6,
    STOREREV_ONLY_HEAD = 1 << 7,
    STOREREV_COUNT = 1 << 8,
    ORIGINAL_MODTIME = 1 << 9,
    ARCHIVE_TRIGGER = 1 << 10
}

export interface IFileType {
    base: FileType;
    modifiers: Modifiers;
    storeRevCount?: number; // only if Modifiers.STOREREV_COUNT or Modifiers.STOREREV_ONLY_HEAD
}

export function GetFileType(headType?: string): IFileType {
    const result: IFileType = { base: FileType.UNKNOWN, modifiers: Modifiers.NONE };

    if (!headType || headType.length === 0) {
        return result;
    }

    const headTypes: string[] = headType.split("+");
    if (headTypes.length === 0) {
        return result;
    }

    switch (headTypes[0].trim().toLowerCase()) {
        case "text":
            result.base = FileType.TEXT;
            break;
        case "binary":
            result.base = FileType.BINARY;
            break;
        case "symlink":
            result.base = FileType.SYMLINK;
            break;
        case "apple":
            result.base = FileType.APPLE;
            break;
        case "resource":
            result.base = FileType.RESOURCE;
            break;
        case "unicode":
            result.base = FileType.UNICODE;
            break;
        case "utf8":
            result.base = FileType.UTF8;
            break;
        case "utf16":
            result.base = FileType.UTF16;
            break;
        default:
            break;
    }

    if (headTypes.length === 1) {
        return result;
    }

    for (let idx = 0; idx < headTypes[1].length; ++idx) {
        const ch = headTypes[1][idx];
        switch (ch) {
            case "w":
                result.modifiers |= Modifiers.WRITABLE;
                break;
            case "x":
                result.modifiers |= Modifiers.EXECUTE;
                break;
            case "k":
                result.modifiers |= Modifiers.RCS_KEYWORD_EXPANSION;
                break;
            case "l":
                result.modifiers |= Modifiers.EXCLUSIVE_OPEN;
                break;
            case "C":
                result.modifiers |= Modifiers.STOREREV_FULL_COMPRESSED;
                break;
            case "D":
                result.modifiers |= Modifiers.STOREREV_RSC_DELTA;
                break;
            case "F":
                result.modifiers |= Modifiers.STOREREV_FULL_FILE;
                break;
            case "m":
                result.modifiers |= Modifiers.ORIGINAL_MODTIME;
                break;
            case "X":
                result.modifiers |= Modifiers.ARCHIVE_TRIGGER;
                break;
            case "S": {
                result.storeRevCount = 1;

                if (idx + 1 < headTypes[1].length) {
                    const nextCh = headTypes[1][idx + 1];
                    const asNum = Number(nextCh);
                    if (!Number.isNaN(asNum)) {
                        result.storeRevCount = asNum;
                    }
                }

                result.modifiers |=
                    result.storeRevCount === 1
                        ? Modifiers.STOREREV_ONLY_HEAD
                        : Modifiers.STOREREV_COUNT;
            }
            default:
                break;
        }
    }

    return result;
}
