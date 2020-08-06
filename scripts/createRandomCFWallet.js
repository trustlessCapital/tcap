const WalletFactory = require('../build/WalletFactory');
const MultiSigWallet = require('../build/MultiSigWallet');

const MultisigExecutor = require('../utils/multisigexecutor.js');
const DeployManager = require('../utils/deploy-manager.js');
const utilities = require('../utils/utilities.js');
const { randomBytes, bigNumberify } = require('ethers').utils;

async function main() {
    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;

    const mn = utilities.createMnemonic()
    console.log("Mnemonic: ", mn)
    const privateKey = utilities.createPrivateKeyFromMnemonic(mn)
    
    const owner = utilities.createAddressFromPrivateKey(privateKey)
    
    const config = configurator.config;

    const walletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const multisigWrapper = await deployer.wrapDeployedContract(MultiSigWallet, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(multisigWrapper, manager, config.multisig.autosign);

    // Make manager a temporary manager of WalletFactory to facilitate wallet initialization
    let revokeManager = false;
    if (!await walletFactoryWrapper.managers(manager.address)) {
        console.log(`Adding accounts[0] (${manager.address}) as Manager of WalletFactory...`);
        await multisigExecutor.executeCall(walletFactoryWrapper, "addManager", [manager.address]);
        revokeManager = true;
    }

    // Create Wallet
    console.log("Creating new wallet...");
    const modules = [
        config.modules.GuardianHandler,
        config.modules.LockHandler,
        config.modules.RecoveryHandler,
        config.modules.ApprovedTransfer,
        config.modules.TransferHandler,
        config.modules.TokenSwapHandler
    ];

    let salt = bigNumberify(randomBytes(32)).toHexString ();
    // Get the future address
    let futureAddr = await walletFactoryWrapper.getAddressForCounterfactualWallet(owner, modules, salt); 
    console.log(`Future address of the wallet is: ${futureAddr}`)
    const tx = await (walletFactoryWrapper.from && walletFactoryWrapper.from(manager) || walletFactoryWrapper).createCounterfactualWallet(owner, modules, salt);
    const txReceipt = await walletFactoryWrapper.verboseWaitForTransaction(tx);
    let walletAddress = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
    console.log(`New wallet successfully created at address ${walletAddress} for owner ${owner}.`);

    // Remove temporary manager from WalletFactory
    if (revokeManager === true) {
        console.log(`Removing manager (${manager.address}) as Manager of WalletFactory...`)
        await multisigExecutor.executeCall(walletFactoryWrapper, "revokeManager", [manager.address]);
    }

}

main().catch(err => {
    throw err;
});