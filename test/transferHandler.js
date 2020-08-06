const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const TransferStorage = require("../build/TransferStorage");
const GuardianStorage = require("../build/GuardianStorage");
const TransferModule = require("../build/TransferHandler");
const KyberNetwork = require("../build/KyberNetworkTest");
const TokenPriceProvider = require("../build/TokenPriceProvider");
const ERC20 = require("../build/TestERC20");
const TestContract = require('../build/TestContract');

// added TokenSwapHandler for calculating fees into token
const TokenSwapHandler = require("../build/TokenSwapHandler");
const FEE_RATIO = 30;

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const DECIMALS = 12; // number of decimal for TOKN contract
const KYBER_RATE = ethers.utils.bigNumberify(51 * 10 ** 13); // 1 TOKN = 0.00051 ETH
const ZERO_BYTES32 = ethers.constants.HashZero;

const ACTION_TRANSFER = 0;

const TestManager = require("../utils/test-manager");

describe("Test TransferHandler", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;
    let recipient = accounts[3].signer;
    let spender = accounts[4].signer;
    let collector = accounts[2].signer;

    let kyber, registry, priceProvider, transferStorage, guardianStorage, transferModule, wallet, exchanger;

    before(async () => {
        deployer = manager.newDeployer();
        registry = await deployer.deploy(Registry);
        kyber = await deployer.deploy(KyberNetwork);
        priceProvider = await deployer.deploy(TokenPriceProvider, {}, kyber.contractAddress);
        transferStorage = await deployer.deploy(TransferStorage);
        guardianStorage = await deployer.deploy(GuardianStorage);
        exchanger = await deployer.deploy(TokenSwapHandler, {}, registry.contractAddress, guardianStorage.contractAddress, kyber.contractAddress, collector.address, FEE_RATIO);
        
        transferModule = await deployer.deploy(TransferModule, {},
            registry.contractAddress,
            transferStorage.contractAddress,
            guardianStorage.contractAddress,
            priceProvider.contractAddress,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            ETH_LIMIT
        );
        await registry.registerModule(transferModule.contractAddress, ethers.utils.formatBytes32String("TransferModule"));
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [transferModule.contractAddress]);
        erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await kyber.addToken(erc20.contractAddress, KYBER_RATE, DECIMALS);
        await priceProvider.syncPrice(erc20.contractAddress);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.utils.bigNumberify('1000000000000000000') });
    });

    describe("Managing limit and whitelist ", () => {

        it('should set the default limit for new wallets', async () => {
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
        });
        it('should only change the limit after the security period', async () => {
            await transferModule.from(owner).changeLimit(wallet.contractAddress, 4000000);
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should change the limit via relayed transaction', async () => {
            await manager.relay(transferModule, 'changeLimit', [wallet.contractAddress, 4000000], wallet, [owner]);
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should add/remove an account to/from the whitelist', async () => {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
            let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, false, "should not be trusted during the security period");
            await manager.increaseTime(3);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, true, "should be trusted after the security period");
            await transferModule.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, false, "should not removed from whitemist immediately");
        });
    });

    describe("Token transfers", () => {

        async function doDirectTransfer({ token, signer = owner, to, amount, relayed = false }) {
            let fundsBefore = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress, to.address, amount, ZERO_BYTES32];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'transferToken', params, wallet, [signer]);
            } else {
                const tx = await transferModule.from(signer).transferToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "Transfer"), "should have generated Transfer event");
            let fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, 'should have transfered amount');
            let ethValue = (token == ETH_TOKEN ? amount : (await priceProvider.getEtherValue(amount, token.contractAddress)).toNumber());
            if (ethValue < ETH_LIMIT) {
                assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, 'should have updated the daily spent in ETH');
            }
            return txReceipt;
        }

        // Modified Function
        async function doDirectTransferModified({ token, signer = owner, to, amount, relayed = false }) {
            let fundsBefore = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress, to.address, amount, ZERO_BYTES32];
            
            let txReceipt, fee;
            if (relayed) {

                if(params[1] != ETH_TOKEN) {
                    let gasUsed1 = await manager.relay(transferModule, 'transferToken', params, wallet, [signer],this.accounts[9].signer,true);
                    let rate1 = await exchanger.getExpectedTrade(ETH_TOKEN, params[1], gasUsed1);
                    let _destAmount1 = ethers.utils.bigNumberify(rate1[0]).toNumber();

                    let params2 = [wallet.contractAddress, token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress, this.accounts[9].signer.address, _destAmount1, ZERO_BYTES32];

                    let gasUsed2 = await manager.relay(transferModule, 'transferToken', params2, wallet, [signer], this.accounts[9].signer, true);

                    let rate2 = await exchanger.getExpectedTrade(ETH_TOKEN, params[1], gasUsed2);
                    let _destAmount2 = ethers.utils.bigNumberify(rate2[0]).toNumber();
                    
                    fee = _destAmount1 + _destAmount2;
                    params2[3] = _destAmount1 + _destAmount2;
                    
                    txReceipt = await manager.relayModified(transferModule, 'transferToken', params,params2, wallet, [signer]);               

                } else {
                    txReceipt = await manager.relay(transferModule, 'transferToken', params, wallet, [signer]);                    
                }
                
            } else {
                const tx = await transferModule.from(signer).transferToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "Transfer"), "should have generated Transfer event");
            let fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, 'should have transfered amount');
            let ethValue = (token == ETH_TOKEN ? amount : (await priceProvider.getEtherValue(amount+fee, token.contractAddress)).toNumber());
            if (ethValue < ETH_LIMIT) {
                assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, 'should have updated the daily spent in ETH');
            }
            return txReceipt;
        }

        async function doPendingTransfer({ token, to, amount, delay, relayed = false }) {
            let tokenAddress = token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress;
            let fundsBefore = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            const params = [wallet.contractAddress, tokenAddress, to.address, amount, ZERO_BYTES32];
            let txReceipt, tx;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'transferToken', params, wallet, [owner]);
            } else {
                tx = await transferModule.from(owner).transferToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCreated"), "should have generated PendingTransferCreated event");
            let fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), 0, 'should not have transfered amount');
            if (delay == 0) {
                let id = ethers.utils.solidityKeccak256(['uint8', 'address', 'address', 'uint256', 'bytes', 'uint256'], [ACTION_TRANSFER, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber]);
                return id;
            }
            await manager.increaseTime(delay);
            tx = await transferModule.executePendingTransfer(wallet.contractAddress, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber);
            txReceipt = await transferModule.verboseWaitForTransaction(tx);
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferExecuted"), "should have generated PendingTransferExecuted event");
            fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, 'should have transfered amount');
        }

        async function doPendingTransferModified({ token, to, amount, delay, relayed = false }) {
            let tokenAddress = token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress;
            let fundsBefore = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            const params = [wallet.contractAddress, tokenAddress, to.address, amount, ZERO_BYTES32];
            let txReceipt, tx, fee;
            if (relayed) {

                if(params[1] != ETH_TOKEN) {
                    let gasUsed1 = await manager.relay(transferModule, 'transferToken', params, wallet, [owner],this.accounts[9].signer,true);
                    let rate1 = await exchanger.getExpectedTrade(ETH_TOKEN, params[1], gasUsed1);
                    let _destAmount1 = ethers.utils.bigNumberify(rate1[0]).toNumber();

                    let params2 = [wallet.contractAddress, token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress, this.accounts[9].signer.address, _destAmount1, ZERO_BYTES32];

                    let gasUsed2 = await manager.relay(transferModule, 'transferToken', params2, wallet, [owner], this.accounts[9].signer, true);

                    let rate2 = await exchanger.getExpectedTrade(ETH_TOKEN, params[1], gasUsed2);
                    let _destAmount2 = ethers.utils.bigNumberify(rate2[0]).toNumber();
                    
                    fee = _destAmount1 + _destAmount2;
                    params2[3] = _destAmount1 + _destAmount2;
                    
                    txReceipt = await manager.relayModified(transferModule, 'transferToken', params,params2, wallet, [owner]);
                } else {
                    txReceipt = await manager.relay(transferModule, 'transferToken', params, wallet, [owner]);                    
                }
            
            } else {
                tx = await transferModule.from(owner).transferToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCreated"), "should have generated PendingTransferCreated event");
            let fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), 0, 'should not have transfered amount');
            if (delay == 0) {
                let id = ethers.utils.solidityKeccak256(['uint8', 'address', 'address', 'uint256', 'bytes', 'uint256'], [ACTION_TRANSFER, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber]);
                return id;
            }
            await manager.increaseTime(delay);
            tx = await transferModule.executePendingTransfer(wallet.contractAddress, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber);
            txReceipt = await transferModule.verboseWaitForTransaction(tx);
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferExecuted"), "should have generated PendingTransferExecuted event");
            fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, 'should have transfered amount');
        }

        describe("Small token transfers", () => {

            it('should let the owner send ETH', async () => {
                await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
            });
            it('should let the owner send ETH (relayed)', async () => {
                await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000, relayed: true });
            });
            it('should let the owner send ERC20', async () => {
                await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
            });
            it('should let the owner send ERC20 (relayed)', async () => {
                await doDirectTransfer({ token: erc20, to: recipient, amount: 10, relayed: true });
            });
            it('should let the owner send ERC20 (relayed) (modified)', async () => {
                await doDirectTransferModified({ token: erc20, to: recipient, amount: 10, relayed: true });
            });
            it('should only let the owner send ETH', async () => {
                try {
                    await doDirectTransfer({ token: ETH_TOKEN, signer: nonowner, to: recipient, amount: 10000 });
                } catch (error) {
                    assert.ok(await manager.isRevertReason(error, "must be an owner"));
                }
            });
            it('should calculate the daily unspent when the owner send ETH', async () => {
                let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
                assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'unspent should be the limit at the beginning of a period');
                await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
                unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
                assert.equal(unspent[0].toNumber(), ETH_LIMIT - 10000, 'should be the limit minuss the transfer');
            });
            it('should calculate the daily unspent in ETH when the owner send ERC20', async () => {
                let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
                assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'unspent should be the limit at the beginning of a period');
                await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
                unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
                let ethValue = await priceProvider.getEtherValue(10, erc20.contractAddress);
                assert.equal(unspent[0].toNumber(), ETH_LIMIT - ethValue.toNumber(), 'should be the limit minuss the transfer');
            });
        });

        describe("Large token transfers ", () => { 

            it('should create and execute a pending ETH transfer', async () => {
                await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: false });
            });
            it('should create and execute a pending ETH transfer (relayed)', async () => {
                await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: true });
            });
            it('should create and execute a pending ERC20 transfer', async () => {
                await doPendingTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: false });
            });
            it('should create and execute a pending ERC20 transfer (relayed)', async () => {
                await doPendingTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: true });
            });
            it('should create and execute a pending ERC20 transfer (relayed) (modified)', async () => {
                await doPendingTransferModified({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: true });
            });
            it('should not execute a pending ERC20 transfer before the confirmation window (relayed) (modified)', async () => {
                try {
                    await doPendingTransferModified({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 10, relayed: true });
                } catch (error) {
                    assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
                }
            });
            it('should not execute a pending ETH transfer before the confirmation window', async () => {
                try {
                    await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 1, relayed: false });
                } catch (error) {
                    assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
                }
            });
            it('should not execute a pending ETH transfer before the confirmation window (relayed)', async () => {
                try {
                    await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 1, relayed: true });
                } catch (error) {
                    assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
                }
            });
            it('should not execute a pending ETH transfer after the confirmation window', async () => {
                try {
                    await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 10, relayed: false });
                } catch (error) {
                    assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
                }
            });
            it('should not execute a pending ETH transfer after the confirmation window (relayed)', async () => {
                try {
                    await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 10, relayed: true });
                } catch (error) {
                    assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
                }
            });
            it('should cancel a pending ETH transfer', async () => {
                let id = await doPendingTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 0 });
                await manager.increaseTime(1);
                let tx = await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
                let txReceipt = await transferModule.verboseWaitForTransaction(tx);
                assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCanceled"), "should have generated PendingTransferCanceled event");
                let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
                assert.equal(executeAfter, 0, 'should have cancelled the pending transfer');
            });
            it('should cancel a pending ERC20 transfer', async () => {
                let id = await doPendingTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 0 });
                await manager.increaseTime(1);
                let tx = await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
                let txReceipt = await transferModule.verboseWaitForTransaction(tx);
                assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCanceled"), "should have generated PendingTransferCanceled event");
                let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
                assert.equal(executeAfter, 0, 'should have cancelled the pending transfer');
            });
            it('should send immediately ETH to a whitelisted address', async () => {
                await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
                await manager.increaseTime(3);
                await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000 });
            });
            it('should send immediately ERC20 to a whitelisted address', async () => {
                await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
                await manager.increaseTime(3);
                await doDirectTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000 });
            });
        });
    });

    describe("Token Approvals", () => {

        async function doDirectApprove({ signer = owner, amount, relayed = false }) {
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, erc20.contractAddress, spender.address, amount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'approveToken', params, wallet, [signer]);
            } else {
                const tx = await transferModule.from(signer).approveToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "Approved"), "should have generated Approved event");
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            let amountInEth = await priceProvider.getEtherValue(amount, erc20.contractAddress);
            if (amountInEth < ETH_LIMIT) {
                assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, 'should have updated the daily limit');
            }
            let approval = await erc20.allowance(wallet.contractAddress, spender.address);
            assert.equal(approval.toNumber(), amount, "should have approved the amount");
            return txReceipt;
        }

        it('should appprove an ERC20 immediately when the amount is under the limit ', async () => {
            await doDirectApprove({ amount: 10 });
        });
        it('should appprove an ERC20 immediately when the amount is under the limit (relayed) ', async () => {
            await doDirectApprove({ amount: 10, relayed: true });
        });
        it('should not appprove an ERC20 transfer when the signer is not the owner ', async () => {
            try {
                await doDirectApprove({ signer: nonowner, amount: 10 });
            } catch (error) {
                assert.ok(await manager.isRevertReason(error, "must be an owner"));
            }
        });
        it('should appprove an ERC20 immediately when the spender is whitelisted ', async () => {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, spender.address);
            await manager.increaseTime(3);
            await doDirectApprove({ amount: ETH_LIMIT + 10000 });
        });
        it('should fail to appprove an ERC20 when the amount is above the daily limit ', async () => {
            try {
                await doDirectApprove({ amount: ETH_LIMIT + 10000 });
            } catch (error) {
                assert.ok(await manager.isRevertReason(error, "above daily limit"));
            }
        });
    });

    describe("Call contract", () => { 

        let contract, dataToTransfer;

        beforeEach(async () => {
            contract = await deployer.deploy(TestContract);
            assert.equal(await contract.state(), 0, "initial contract state should be 0");
        });

        async function doCallContract({ signer = owner, value, state, relayed = false }) {
            dataToTransfer = contract.contract.interface.functions['setState'].encode([state]);
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, contract.contractAddress, value, dataToTransfer];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'callContract', params, wallet, [signer]);
            } else {
                const tx = await transferModule.from(signer).callContract(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "CalledContract"), "should have generated CalledContract event");
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            if (value < ETH_LIMIT) {
                assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), value, 'should have updated the daily limit');
            }
            assert.equal((await contract.state()).toNumber(), state, 'the state of the external contract should have been changed');
            return txReceipt;
        }

        it('should call a contract and transfer ETH under the limit', async () => {
            await doCallContract({ value: 10, state: 3 });
        });
        it('should call a contract and transfer ETH under the limit (relayed) ', async () => {
            await doCallContract({ value: 10, state: 3, relayed: true });
        });
        it('should call a contract and transfer ETH above my limit value when the contract is whitelisted ', async () => {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
            await manager.increaseTime(3);
            await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
        });
        it('should fail to call a contract and transfer ETH when the amount is above the daily limit ', async () => {
            try {
                await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
            } catch (error) {
                assert.ok(await manager.isRevertReason(error, "above daily limit"));
            }
        });
    });

    describe("Approve token and Call contract", () => {

        let contract, dataToTransfer;

        beforeEach(async () => {
            contract = await deployer.deploy(TestContract);
            assert.equal(await contract.state(), 0, "initial contract state should be 0");
        });

        async function doApproveTokenAndCallContract({ signer = owner, amount, state, relayed = false }) {
            dataToTransfer = contract.contract.interface.functions['setStateAndPayToken'].encode([state, erc20.contractAddress, amount]);
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, erc20.contractAddress, contract.contractAddress, amount, dataToTransfer];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'approveTokenAndCallContract', params, wallet, [signer]);
            } else {
                const tx = await transferModule.from(signer).approveTokenAndCallContract(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "CalledContract"), "should have generated CalledContract event");
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            let amountInEth = await priceProvider.getEtherValue(amount, erc20.contractAddress);
            if (amountInEth < ETH_LIMIT) {
                assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, 'should have updated the daily limit');
            }
            assert.equal((await contract.state()).toNumber(), state, 'the state of the external contract should have been changed');
            let erc20Balance = await erc20.balanceOf(contract.contractAddress);
            assert.equal(erc20Balance.toNumber(), amount, 'the contract should have transfered the tokens');
            return txReceipt;
        }

        it('should approve the token and call the contract when under the limit', async () => {
            await doApproveTokenAndCallContract({ amount: 10, state: 3 });
        });
        it('should approve the token and call the contract when under the limit (relayed) ', async () => {
            await doApproveTokenAndCallContract({ amount: 10, state: 3, relayed: true });
        });
        it('should approve the token and call the contract when the token is above the limit and the contract is whitelisted ', async () => {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
            await manager.increaseTime(3);
            await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
        });
        it('should fail to approve the token and call the contract when the token is above the daily limit ', async () => {
            try {
                await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
            } catch (error) {
                assert.ok(await manager.isRevertReason(error, "above daily limit"));
            }
        });
    });



});