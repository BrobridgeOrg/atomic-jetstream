module.exports = function(RED) {
    let timeoutID=0;

    function PublishNode(config) {
        RED.nodes.createNode(this, config);

        var node = this;
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

			initClient(node, client);
		});

		node.on('close', async () => {
			clearTimeout(timeoutID);
			this.server.releaseClient(client);
		});
    }

	function initClient(node, client) {
		clearTimeout(timeoutID);
		init(node, client)
			.then(() => {
				setStatus(node, 'connected');
			})
			.catch((e) => {
				setStatus(node, 'error');
				node.error(e);

				// retry
				timeoutID = setTimeout(function(){
					initClient(node, client);
				}, 3000);
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

		// Setup events
		client.on('disconnect', () => {
			setStatus(node, 'disconnected');
		});

		client.on('reconnect', () => {
			setStatus(node, 'connecting');
		});

		client.on('connected', () => {
			setStatus(node, 'connected');
		});

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
				node.error(e, msg);
			}
		});
	}

    RED.nodes.registerType('NATS JetStream Publish', PublishNode, {
		credentials: {
		}
	});
}
