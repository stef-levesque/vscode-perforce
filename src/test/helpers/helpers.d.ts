

declare module 'chai' {
    global {
        export namespace Chai {
            interface Assertion {
                vscodeOpenCall(resource : import('vscode').Uri) : void;
                vscodeDiffCall(left : import('vscode').Uri, right : import('vscode').Uri, title : string) : void
            }
        }
        
    }
}