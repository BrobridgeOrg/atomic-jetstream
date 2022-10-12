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

		// heartbeat for message
		let wip = {};
		let heartbeat = setInterval(() => {
			Object.values(wip).forEach((m) => {
				if (m.didAck)
					return;

				m.working();
			})
		}, 5000);

		(async () => {

			if (!this.server) {
				setStatus('disconnected');
				return;
			}

			try {
				// Connect to JetStream Cluster
				let client = await this.server.getClient();
				this.server.refClient();

				client.on('disconnect', () => {
					setStatus('disconnected');
				});

				client.on('reconnect', () => {
					setStatus('connecting');
				});

				node.on('close', async () => {
					clearInterval(heartbeat);
					this.server.unrefClient();
				});

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
					ackWait: Number(config.ackwait),
					queue: config.queue,
				};

				let autoAck = (opts.ack === 'auto') ? true : false;

				// Subscribe to subjects
				let sub = await client.subscribe(config.subjects, config.durable, opts, (m) => {

					// Wait message until done
					if (opts.ackWait <= 0 && !autoAck) {
						wip[m.seq] = m;
					}

					let msg = {
						jetstream: {
							getMsg: () => {
								return m
							},
							ack: () => {
								delete wip[m.seq];
								m.ack();
							}
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
						return;
					}
				});

				node.on('close', async () => {
					sub.unsubscribe();
				});

			} catch(e) {
				node.error(e);
				return
			}
			setStatus('connected');
		})();
    }

    RED.nodes.registerType('NATS JetStream Consumer', ConsumerNode, {
		credentials: {
		}
	});
}
