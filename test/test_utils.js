const utils = require('../utils/utilities.js');

let modules = [
    {
        "address": "0xFFB9239F43673068E3c8D7664382Dd6Fdd6e40cb",
        "name": "ApprovedTransfer"
    },
    {
        "address": "0x25BD64224b7534f7B9e3E16dd10b6dED1A412b90",
        "name": "GuardianHandler"
    },
    {
        "address": "0xe6d5631C6272C8e6190352EC35305e5c03C25Fe1",
        "name": "LockHandler"
    },
    {
        "address": "0xa7939338f2921230aD801b73bfD7758cB09Bccc5",
        "name": "RecoveryHandler"
    },
    {
        "address": "0xE0f4a78BbF24E9624989B9ef10A3B035cc46CE5B",
        "name": "TokenSwapHandler"
    }
];

describe("Utils", function () {
    describe("It should produce the version", () => {
        let version = utils.versionFingerprint(modules);
        console.log(version);
    });
});