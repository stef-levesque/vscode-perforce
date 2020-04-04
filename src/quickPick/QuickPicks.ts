import * as QuickPickProvider from "./QuickPickProvider";
import * as FileQuickPick from "./FileQuickPick";
import * as ChangeQuickPick from "./ChangeQuickPick";
import * as IntegrationQuickPick from "./IntegrationQuickPick";

export const showQuickPickForFile = FileQuickPick.showQuickPickForFile;

export function registerQuickPicks() {
    QuickPickProvider.registerQuickPickProvider(
        "file",
        FileQuickPick.fileQuickPickProvider
    );
    QuickPickProvider.registerQuickPickProvider(
        "filerev",
        FileQuickPick.fileRevisionQuickPickProvider
    );
    QuickPickProvider.registerQuickPickProvider(
        "filediff",
        FileQuickPick.fileDiffQuickPickProvider
    );
    QuickPickProvider.registerQuickPickProvider(
        "change",
        ChangeQuickPick.changeQuickPickProvider
    );
    QuickPickProvider.registerQuickPickProvider(
        "integ",
        IntegrationQuickPick.integrationQuickPickProvider
    );
}
