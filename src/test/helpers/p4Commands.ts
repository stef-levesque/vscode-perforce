import { SinonSpyCall } from "sinon";
import * as vscode from "vscode";

function assertP4UriMatches(
    Assertion: Chai.AssertionStatic,
    got: vscode.Uri,
    expected: vscode.Uri,
    message: string
) {
    new Assertion(got).to.include(
        {
            scheme: expected.scheme,
            path: expected.path,
            authority: expected.authority,
            fragment: expected.fragment
        },
        message
    );
    new Assertion(got.query).to.have.string(expected.query, message);
}

export default function(chai: Chai.ChaiStatic, _utils: Chai.ChaiUtils) {
    const Assertion = chai.Assertion;

    Assertion.addMethod("vscodeOpenCall", function(resource: vscode.Uri) {
        const obj: SinonSpyCall = this._obj as SinonSpyCall;

        new Assertion(obj.args[0]).to.equal("vscode.open");
        assertP4UriMatches(Assertion, obj.args[1], resource, "Resource");
    });

    Assertion.addMethod("vscodeDiffCall", function(
        left: vscode.Uri,
        right: vscode.Uri,
        title: string
    ) {
        const obj: SinonSpyCall = this._obj as SinonSpyCall;

        new Assertion(obj.args[0]).to.equal("vscode.diff");
        assertP4UriMatches(Assertion, obj.args[1], left, "Left Resource");
        assertP4UriMatches(Assertion, obj.args[2], right, "Right Resource");
        new Assertion(obj.args[3]).to.be.string(title, "Title");
    });
}
