const ModuleRegistry = require('../build/ModuleRegistry');
const WalletFactory = require('../build/WalletFactory');
const TokenPriceProvider = require('../build/TokenPriceProvider');

const DeployManager = require('../utils/deploy-manager.js');

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;

    const config = configurator.config;
    console.log('Config:', config);

    const WalletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const TokenPriceProviderWrapper = await deployer.wrapDeployedContract(TokenPriceProvider, config.contracts.TokenPriceProvider);

    ////////////////////////////////////
    // Set contracts' managers
    ////////////////////////////////////

    for (idx in config.backend.accounts) {
        let account = config.backend.accounts[idx];
        const WalletFactoryAddManagerTx = await WalletFactoryWrapper.contract.addManager(account);
        await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);

        const TokenPriceProviderAddManagerTx = await TokenPriceProviderWrapper.contract.addManager(account);
        await TokenPriceProviderWrapper.verboseWaitForTransaction(TokenPriceProviderAddManagerTx, `Set ${account} as the manager of the TokenPriceProvider`);
    }

    ////////////////////////////////////
    // Set contracts' owners
    ////////////////////////////////////

    const wrappers = [WalletFactoryWrapper, ModuleRegistryWrapper];
    for (let idx = 0; idx < wrappers.length; idx++) {
        let wrapper = wrappers[idx];
        const changeOwnerTx = await wrapper.contract.changeOwner(config.contracts.MultiSigWallet);
        await wrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of ${wrapper._contract.contractName}`);
    }
};

module.exports = {
    deploy
};