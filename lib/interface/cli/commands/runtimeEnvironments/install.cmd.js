/* eslint-disable max-len */
const _ = require('lodash');
const Command = require('../../Command');
const { sdk } = require('../../../../logic');
const path = require('path');
const { KubeConfig } = require('kubernetes-client');
const attachRuntimeCmd = require('./attach.cmd');
const installRoot = require('../root/install.cmd');

const getKubeContext = () => {
    // eslint-disable-next-line global-require
    const homedir = require('os').homedir();
    const kubePath = path.join(homedir, '.kube', 'config');
    const kubeconfig = new KubeConfig();
    kubeconfig.loadFromFile(kubePath);
    return kubeconfig.currentContext;
};

const _getAgentData = async (token) => {
    // take the agent id from the token
    const apiKey = token.split('.')[0];
    const agentKey = await sdk.tokens.getById({ id: apiKey });
    if (!agentKey) {
        throw new Error('token is not valid');
    }
    const { subject } = agentKey;

    if (subject.type !== 'agent') {
        throw new Error('token is not assosicated with agent');
    }
    const agentId = agentKey.subject.ref;
    const agentData = await sdk.agents.get({ agentId });
    if (!agentData || agentData === '') {
        throw new Error('failed to get agent data');
    }
    return agentData;
};


const installRuntimeCmd = new Command({
    root: false,
    parent: installRoot,
    command: 'runtime',
    description: 'Install and create a runtime on kubernetes cluster',
    webDocs: {
        category: 'Runtime-Environments',
        title: 'Install Runtime-Environments',
        weight: 100,
    },
    builder: yargs => yargs
        .env('CF_ARG_') // this means that every process.env.CF_ARG_* will be passed to argv
        .option('token', {
            describe: 'Agent\'s token',
        })
        .option('agentName', {
            describe: 'Agent\'s name',
        })
        .option('storageClassName', {
            alias: 'storage-class-name',
            describe: 'Set a name of your custom storage class, note: this will not install volume provisioning components',
        })
        .option('kubeContextName', {
            alias: 'kube-context-name',
            describe: 'Name of the kubernetes context on which the runtime should be installed (default is current-context) [$CF_ARG_KUBE_CONTEXT_NAME]',
        })
        .option('kubeNodeSelector', {
            alias: 'kube-node-selector',
            describe: 'The kubernetes node selector "key=value" to be used by venona build resources (default is no node selector) (string)',
        })
        .option('dryRun', {
            alias: 'dry-run',
            describe: 'Set to true to simulate installation',
        })
        .option('inCluster', {
            alias: 'in-cluster',
            describe: 'Set flag if venona is been installed from inside a cluster',
        })
        .option('kubeNamespace', {
            alias: 'kube-namespace',
            describe: 'Name of the namespace on which runtime should be installed [$CF_ARG_KUBE_NAMESPACE]',
        })
        .option('kubernetesRunnerType', {
            alias: 'kubernetes-runner-type',
            describe: 'Set the runner type to kubernetes (alpha feature)',
        })
        .option('buildAnnotations', {
            alias: 'annotations',
            describe: 'The kubernetes metadata.annotations as "key=value" to be used by venona build resources (default is no node selector)',
        })
        .option('kubeConfigPath', {
            alias: 'kube-config-path',
            describe: 'Path to kubeconfig file (default is $HOME/.kube/config)',
        })
        .option('attachRuntime', {
            alias: 'attach-run-time',
            describe: 'if set to true, auto attach runtime to agent (need to provide ....)',
        })
        .option('serviceAccount', {
            alias: 'kube-service-account',
            describe: 'Runtime service account , deafult is "default"',
        })
        .option('agentKubeContextName', {
            alias: 'agent-kube-context-name',
            describe: 'Agent kubernetes context',
        })
        .option('agentKubeNamespace', {
            alias: 'agent-kube-namespace',
            describe: 'Agent\'s namespace',
        })
        .option('agentKubeConfigPath', {
            alias: 'agent-kube-config-path',
            describe: 'Path to kubeconfig file for the agent (default is $HOME/.kube/config)',
        })
        .option('serviceAccount', {
            alias: 'kube-service-account',
            describe: 'Runtime service account , deafult is "default" (on attach)',
        })
        .option('agentKubeContextName', {
            alias: 'agent-kube-context-name',
            describe: 'Agent kubernetes context (on attach)',
        })
        .option('agentKubeNamespace', {
            alias: 'agent-kube-namespace',
            describe: 'Agent\'s namespace (on attach)',
        })
        .option('agentKubeConfigPath', {
            alias: 'agent-kube-config-path',
            describe: 'Path to kubeconfig file for the agent (default is $HOME/.kube/config) (on attach)',
        })
        .option('verbose', {
            describe: 'Print logs',
        }),
    handler: async (argv) => {
        const {
            storageClassName, agentName,
            kubeContextName, kubeNamespace, dryRun,
            inCluster, kubeNodeSelector, kubernetesRunnerType,
            kubeConfigPath, verbose, buildAnnotations, attachRuntime,
            serviceAccount,
        } = argv;

        let {
            agentKubeContextName, agentKubeNamespace, agentKubeConfigPath, token,
        } = argv;
        const apiHost = sdk.config.context.url;
        const clusterName = kubeContextName || getKubeContext();
        const runtimeName = `${clusterName}/${kubeNamespace}`;

        if (!token) {
            // eslint-disable-next-line prefer-destructuring
            token = sdk.config.context.token;
        }

        // create RE in codefresh
        await sdk.cluster.create({
            namespace: kubeNamespace,
            storageClassName,
            runnerType: kubernetesRunnerType,
            nodeSelector: kubeNodeSelector,
            annotations: buildAnnotations,
            clusterName,
            agent: true,
        });
        console.log(`Runtime envrionment ${runtimeName} was created`);
        // install RE on cluster

        await sdk.runtime.install({
            apiHost,
            name: runtimeName,
            kubeContextName,
            kubeNamespace,
            token,
            dryRun,
            inCluster,
            kubernetesRunnerType,
            kubeConfigPath,
            verbose,
            terminateProcess: !attachRuntime,
        });
        // attach RE to agent in codefresh

        if (attachRuntime) {
            // set defaults for agent options
            if (!agentKubeNamespace) {
                agentKubeNamespace = kubeNamespace;
            }
            if (!agentKubeContextName) {
                agentKubeContextName = kubeContextName;
            }
            if (!agentKubeConfigPath) {
                agentKubeConfigPath = kubeConfigPath;
            }

            await attachRuntimeCmd.handler({
                agentName,
                runtimeName,
                kubeContextName,
                kubeNamespace,
                kubeConfigPath,
                serviceAccount,
                agentKubeContextName,
                agentKubeNamespace,
                agentKubeConfigPath,
                terminateProcess: true,
            });
        } else {
            console.log('Please run agent attach in order to link agent and runtime');
        }
    },
});


module.exports = installRuntimeCmd;