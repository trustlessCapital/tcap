const GuardianHandler = require("../build/GuardianHandler");
const LockHandler = require("../build/LockHandler");
const GuardianStorage = require("../build/GuardianStorage");
const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

describe("LockHandler", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let owner = accounts[1].signer;
    let guardian1 = accounts[2].signer;
    let nonguardian = accounts[3].signer;

    let guardianHandler, lockHandler, wallet;

    beforeEach(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        let guardianStorage = await deployer.deploy(GuardianStorage);
        guardianHandler = await deployer.deploy(GuardianHandler, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
        lockHandler = await deployer.deploy(LockHandler, {}, registry.contractAddress, guardianStorage.contractAddress, 24 * 5);
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [guardianHandler.contractAddress, lockHandler.contractAddress]);
    });

    describe("(Un)Lock by EOA guardians", () => {
        beforeEach(async () => {
            await guardianHandler.from(owner).addGuardian(wallet.contractAddress, guardian1.address, { gasLimit: 500000 });
            const count = (await guardianHandler.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, "1 guardian should be added");
            const isGuardian = await guardianHandler.isGuardian(wallet.contractAddress, guardian1.address);
            assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
            const isLocked = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should be unlocked by default");
        });

        it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
            // lock
            await lockHandler.from(guardian1).lock(wallet.contractAddress);
            let state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isTrue(state, "should be locked by guardian");
            let releaseTime = await lockHandler.getLock(wallet.contractAddress);
            console.log("releaseTime: ",releaseTime)
            assert.isTrue(releaseTime > 0, "releaseTime should be positive");
            // unlock
            await lockHandler.from(guardian1).unlock(wallet.contractAddress);
            state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(state, "should be unlocked by guardian");
            releaseTime = await lockHandler.getLock(wallet.contractAddress);
            console.log("releaseTime: ",releaseTime)
            
            assert.equal(releaseTime, 0, "releaseTime should be zero");
        });

        it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
            await manager.relay(lockHandler, "lock", [wallet.contractAddress], wallet, [guardian1]);
            let state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isTrue(state, "should be locked by guardian");

            await manager.relay(lockHandler, "unlock", [wallet.contractAddress], wallet, [guardian1]);
            state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(state, "should be unlocked by guardian");
        });

        it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
            await assert.revert(lockHandler.from(nonguardian).lock(wallet.contractAddress), "locking from non-guardian should fail");

            await lockHandler.from(guardian1).lock(wallet.contractAddress);
            const state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isTrue(state, "should be locked by guardian1");

            await assert.revert(lockHandler.from(nonguardian).unlock(wallet.contractAddress));
        });
    });

    describe("(Un)Lock by Smart Contract guardians", () => {
        beforeEach(async () => {
            guardianWallet = await deployer.deploy(Wallet);
            await guardianWallet.init(guardian1.address, [guardianHandler.contractAddress, lockHandler.contractAddress]);
            await guardianHandler.from(owner).addGuardian(wallet.contractAddress, guardianWallet.contractAddress, { gasLimit: 500000 });
            const count = (await guardianHandler.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, "1 guardian should be added");
            const isGuardian = await guardianHandler.isGuardian(wallet.contractAddress, guardianWallet.contractAddress);
            assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
            let isLocked = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should be unlocked by default");
        });

        it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
            await manager.relay(lockHandler, "lock", [wallet.contractAddress], wallet, [guardian1]);
            let state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isTrue(state, "should be locked by guardian");

            await manager.relay(lockHandler, "unlock", [wallet.contractAddress], wallet, [guardian1]);
            state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(state, "should be unlocked by locker");
        });

        it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
            let txReceipt = await manager.relay(lockHandler, "lock", [wallet.contractAddress], wallet, [nonguardian]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "locking from non-guardian should fail");
        });
    });

    describe("Auto-unlock", () => {
        it("should auto-unlock after lock period", async () => {
            await guardianHandler.from(owner).addGuardian(wallet.contractAddress, guardian1.address, { gasLimit: 500000 });
            await lockHandler.from(guardian1).lock(wallet.contractAddress);
            let state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isTrue(state, "should be locked by guardian");
            let releaseTime = await lockHandler.getLock(wallet.contractAddress);
            assert.isTrue(releaseTime > 0, "releaseTime should be positive");

            await manager.increaseTime(24 * 5 + 5);
            state = await lockHandler.isLocked(wallet.contractAddress);
            assert.isFalse(state, "should be unlocked by guardian");
            releaseTime = await lockHandler.getLock(wallet.contractAddress);
            assert.equal(releaseTime, 0, "releaseTime should be zero");
        });
    });
});