module.exports = function(RED) {

    function ConsumerNode(config) {

        RED.nodes.createNode(this, config);
        var node = this;

		// Getting server information from gravity server node
		this.server = RED.nodes.getNode(config.server)

		function setStatus(type) {
			switch(type) {
			case 'connected':
				node.status({
					fill: 'green',
					shape: 'dot',
					text: 'connected'
				});
				break;
			case 'connecting':
				node.status({
					fill: 'yellow',
					shape: 'ring',
					text: 'connecting'
				});
				break;
			case 'initializing':
				node.status({
					fill: 'yellow',
					shape: 'ring',
					text: 'initializing'
				});
				break;
			case 'disconnected':
				node.status({
					fill: 'red',
					shape: 'ring',
					text: 'disconnected'
				});
				break;
			case 'receiving':
				node.status({
					fill: 'blue',
					shape: 'ring',
					text: 'receiving'
				});
				break;
			}
		}

		function ack() {
			this.ack();
			setStatus('connected');
		}

		setStatus('disconnected');

		// Initializing NATS JetStream client
		let nats = require('nats');
		let Client = require('./client');

		(async () => {

			if (!this.server) {
				setStatus('disconnected');
				return;
			}

			let client = new Client(this.server.getOpts());

			try {
				setStatus('connecting');

				node.log('Connecting to JetStream server:' + this.server.getOpts().server)

				// Connect to JetStream Cluster
				await client.connect()

				client.on('disconnect', () => {
					node.log('Disconnected from JetStream server')
					setStatus('disconnected');
				});

				client.on('reconnect', () => {
					node.log('Reconnecting to JetStream server')
					setStatus('connecting');
				});
			} catch(e) {
				node.error(e);
				setStatus('disconnected');
				return;
			}

			if (!config.subjects) {
				setStatus('connected');
				return;
			}

			setStatus('initializing');

			// Preparing consumer options
			let opts = {
				delivery: config.delivery || 'last',
				ack: config.ack || 'auto',
				startSeq: Number(config.startseq),
				startTime: new Date(Number(config.starttime) * 1000),
			};

			try {

				let autoAck = (opts.ack === 'auto') ? true : false;

				// Subscribe to subjects
				await client.subscribe(config.subjects, config.durable, opts, (m) => {

					let msg = {
						jetstream: {
							getMsg: () => {
								return m
							},
						},
						payload: {
							seq: m.seq,
							subject: m.subject,
						}
					}

					switch(config.payloadType) {
					case 'json':
						msg.payload.data = JSON.parse(m.data);
						break;
					case 'string':
						msg.payload.data = m.data.toString();
						break;
					default:
						msg.payload.data = m.data;
					}

					node.send(msg);

					// Sent acknoledgement automatically
					if (autoAck && !m.didAck) {
						m.ack();
					}
				});
			} catch(e) {
				node.error(e);
				return
			}

			node.on('close', async () => {
				client.disconnect();
			});

			setStatus('connected');
		})();
    }

    RED.nodes.registerType('NATS JetStream Consumer', ConsumerNode, {
		credentials: {
		}
	});
}
