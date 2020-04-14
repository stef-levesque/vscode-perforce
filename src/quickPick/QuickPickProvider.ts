import * as vscode from "vscode";
import { isTruthy } from "../TsUtils";

export function asUri(uri: vscode.Uri | string) {
    if (typeof uri === "string") {
        return vscode.Uri.parse(uri);
    }
    return uri;
}

export type ActionableQuickPick = {
    items: ActionableQuickPickItem[];
    excludeFromHistory?: boolean;
    placeHolder: string;
};

export interface ActionableQuickPickProvider {
    provideActions: (...args: any) => Promise<ActionableQuickPick>;
}

export interface ActionableQuickPickItem extends vscode.QuickPickItem {
    performAction?: () => void | Promise<any>;
}

const registeredQuickPickProviders = new Map<string, ActionableQuickPickProvider>();

type QuickPickInstance = {
    type: string;
    args: any[];
    description: string;
};

const quickPickStack: QuickPickInstance[] = [];

export function registerQuickPickProvider(
    type: string,
    provider: ActionableQuickPickProvider
) {
    registeredQuickPickProviders.set(type, provider);
}

const backLabel = "$(discard) Go Back";

function makeStackActions(): ActionableQuickPickItem[] {
    const prev = quickPickStack[quickPickStack.length - 1];
    return [
        prev
            ? {
                  label: backLabel,
                  description: "to " + prev.description,
                  performAction: () => {
                      quickPickStack.pop();
                      showQuickPick(prev.type, ...prev.args);
                  },
              }
            : {
                  label: backLabel,
                  description: "n/a",
              },
    ].filter(isTruthy);
}

export async function showQuickPick(type: string, ...args: any[]) {
    const provider = registeredQuickPickProviders.get(type);

    if (provider) {
        const actions = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Getting actions for quick pick",
                cancellable: false,
            },
            () => provider.provideActions(...args)
        );
        const stackActions = makeStackActions();

        const picked = await vscode.window.showQuickPick(
            stackActions.concat(actions.items),
            {
                //ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: actions.placeHolder,
            }
        );

        const isNoOp = picked && !picked.performAction;
        if (isNoOp) {
            // show own menu again, without adding this one to the stack
            await showQuickPick(type, ...args);
            return;
        }

        if (backLabel !== picked?.label && !actions.excludeFromHistory) {
            quickPickStack.push({ type, args, description: actions.placeHolder });
        }

        await picked?.performAction?.();
    } else {
        throw new Error("No registered quick pick provider for type " + type);
    }
}

export function toRevString(startRev: string | undefined, endRev: string) {
    return startRev ? startRev + "," + endRev : endRev;
}
