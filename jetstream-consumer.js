module.exports = function(RED) {

    function ConsumerNode(config) {

        RED.nodes.createNode(this, config);
        var node = this;

		// Getting server information from gravity server node
		this.server = RED.nodes.getNode(config.server)
		this.config = config;

		setStatus(node, 'disconnected');

		if (!this.server) {
			setStatus(node, 'disconnected');
			return;
		}

		// Preparing client
		let client = null;
		let jsMgr = this.server.getInstance()
		jsMgr.once('ready', () => {

			setStatus(jsMgr.status)

			// Getting a client
			client = this.server.allocateClient();

			init(node, client)
				.then(() => {
					setStatus(node, 'connected');
				})
				.catch((e) => {
					setStatus(node, 'error');
					node.error(e);
				});
		});
		
		// heartbeat for message
		this.wip = {};
		let heartbeat = setInterval(() => {
			Object.values(node.wip).forEach((m) => {
				if (m.didAck)
					return;

				m.working();
			})
		}, 5000);

		node.on('close', async () => {
			this.wip = {};
			clearInterval(heartbeat);
			this.server.releaseClient(client);
		});
    }

	async function init(node, client) {

		// Setup events
		client.on('disconnect', () => {
			setStatus(node, 'disconnected');
		});

		client.on('reconnect', () => {
			setStatus(node, 'connecting');
		});

		client.on('connected', () => {
			setStatus(node, 'connecting');
		});

		if (!node.config.subjects) {
			node.error('require subjects');
			return;
		}

		setStatus(node, 'initializing');

		// Ensure stream
		if (node.config.stream === 'ensure') {

			let streamNode = RED.nodes.getNode(node.config.ensurestream);

			if (!streamNode)
				throw new Error('No specific stream');

			node.log('Initializing stream ' + streamNode.config.stream);

			try {
				await client.ensureStream(streamNode.config.stream, streamNode.config.subjects, streamNode.getOptions());
			} catch(e) {
				console.log('failed to initialize stream');
				throw e;
			}
		}

		// Preparing consumer options
		let opts = {
			delivery: node.config.delivery || 'last',
			ack: node.config.ack || 'auto',
			startSeq: Number(node.config.startseq),
			startTime: new Date(Number(node.config.starttime) * 1000),
			ackWait: Number(node.config.ackwait),
		};

		if (node.config.consumertype !== 'ephemeral') {

			// Check if durable is set
			if (!node.config.durable) {
				throw new Error('require durable for non-ephemeral consumer');
			}

			opts.durable = node.config.durable;

			if (node.config.consumertype === 'queueGroup') {
				opts.ack = 'manual';
				opts.queue = true;
			}
		}

		// wait forever
		let keepalive = false;
		if (opts.ackWait <= 0) {
			opts.ackWait = 10000;

			keepalive = true;
		}

		let autoAck = (opts.ack === 'auto') ? true : false;

		if (!autoAck) {
			 opts.maxAckPending = Number(node.config.maxackpending) || 2000;
		}

		try {
			node.log('subscribing to ' + node.config.subjects);

			// Subscribe to subjects
			let sub = await client.subscribe(node.config.subjects, opts, (m) => {

				// Wait message until done
				if (keepalive) {
					node.wip[m.seq] = m;
				}

				let msg = {
					jetstream: {
						getMsg: () => {
							return m
						},
						ack: () => {
							delete node.wip[m.seq];
							if (m.didAck)
								return;

							m.ack();
						},
						nak: () => {
							delete node.wip[m.seq];
							m.nak();
						}
					},
					payload: {
						seq: m.seq,
						subject: m.subject,
						data: m.data,
					}
				}

				try {
					switch(node.config.payloadType) {
					case 'json':
						msg.payload.data = JSON.parse(client.decode(m.data));
						break;
					case 'string':
						msg.payload.data = client.decode(m.data);
						break;
					default:
						msg.payload.data = m.data;
					}
				} catch(e) {
					node.error(m.seq);
					node.error(e);
					console.log(client.decode(m.data));
				}

				node.send(msg);

				// Sent acknoledgement automatically
				if (autoAck && !m.didAck) {
					m.ack();
					return;
				}
			});

			node.once('close', async () => {
				sub.unsubscribe();
			});

		} catch(e) {
			console.log('Failed to subscribe for', node.config.subjects);
			throw e;
		}
	}

	function setStatus(node, type) {
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
		case 'error':
			node.status({
				fill: 'red',
				shape: 'ring',
				text: 'error'
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

    RED.nodes.registerType('NATS JetStream Consumer', ConsumerNode, {
		credentials: {
		}
	});
}
