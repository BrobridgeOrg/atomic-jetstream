module.exports = function(RED) {

    function AcknowledgeNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

		node.on('input', function(msg, send, done) {

			if (!msg.jetstream)
				return done();

			if (config.action === 'nak') {
				msg.jetstream.nak();
			} else {
				msg.jetstream.ack();
			}

			if (done) {
				return done();
			}
		})
	}

    RED.nodes.registerType('NATS JetStream Acknowledge', AcknowledgeNode);
}

