module.exports = function(RED) {

    function PublishNode(config) {
        RED.nodes.createNode(this, config);

        var node = this;
		this.server = RED.nodes.getNode(config.server)
		this.config = config;

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
					node.error(e);
				});
		});

		node.on('close', async () => {
			this.server.releaseClient(client);
		});
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
		case 'disconnected':
			node.status({
				fill: 'red',
				shape: 'ring',
				text: 'disconnected'
			});
			break;
		}
	}

	async function init(node, client) {

		node.on('input', async (msg, send, done) => {

			let subject = msg.subject || node.config.subject;
			if (!subject) {
				return done();
			}

			try {

				switch(node.config.payloadType) {
				case 'json':
					if (typeof msg.payload === 'string') {
						await client.publishString(subject, msg.payload);
					} else {
						await client.publishJSON(subject, msg.payload);
					}
					break;
				case 'string':
					await client.publishString(subject, msg.payload);
					break;
				default:
					await client.publish(subject, msg.payload);
				}

				done();
			} catch(e) {
				node.error(e);
			}
		});
	}

    RED.nodes.registerType('NATS JetStream Publish', PublishNode, {
		credentials: {
		}
	});
}
