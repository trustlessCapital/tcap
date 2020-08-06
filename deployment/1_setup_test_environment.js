const Kyber = require('../build/KyberNetworkTest');
const ERC20 = require('../build/TestERC20');

const DeployManager = require('../utils/deploy-manager.js');

const TEST_ERC20_SUPPLY = 1000000000; //10**9
const TEST_ERC20_DECIMALS = 10;
const TEST_ERC20_RATE = 6 * 10**14; // 1 TCT = 0.0006 ETH

// For development purpose
async function deployKyber(deployer) {
    const KyberWrapper = await deployer.deploy(Kyber);
	const ERC20Wrapper = await deployer.deploy(ERC20, {}, [KyberWrapper.contractAddress], TEST_ERC20_SUPPLY, TEST_ERC20_DECIMALS);

	const addToken = await KyberWrapper.contract.addToken(ERC20Wrapper.contractAddress, TEST_ERC20_RATE, TEST_ERC20_DECIMALS);
	await KyberWrapper.verboseWaitForTransaction(addToken, 'Add test token to Kyber');

    return KyberWrapper.contractAddress;
}

const deploy = async (network, secret) => {

	const manager = new DeployManager(network);
	await manager.setup();

	const configurator = manager.configurator;
	const deployer = manager.deployer;

	const config = configurator.config;

	if (config.Kyber.deployOwn) {
        // Deploy Kyber Network if needed
        const address = await deployKyber(deployer);
        configurator.updateKyberContract(address);
	}

    // save configuration
    await configurator.save();
};

module.exports = {
	deploy
};