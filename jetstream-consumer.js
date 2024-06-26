module.exports = function(RED) {
    let timeoutID=0;

    function ConsumerNode(config) {

      RED.nodes.createNode(this, config);
      var node = this;

      // Getting server information from gravity server node
      this.server = RED.nodes.getNode(config.server)
      this.config = config;
      this.pending = 0;

      setStatus(node, 'disconnected');

      if (!this.server) {
        return;
      }

      setStatus(node, this.server.status);

      // Preparing client
      let client = null;
      let jsMgr = this.server.getInstance()
      jsMgr.once('ready', () => {

        setStatus(jsMgr.status)

        // Getting a client
        client = this.server.allocateClient();

        // Setup events
        client.on('disconnect', () => {
          node.log('disconnected');
          setStatus(node, 'disconnected');
        });

        client.on('reconnect', () => {
          setStatus(node, 'connecting');
        });

        client.on('connected', () => {
          setStatus(node, 'connected');
        });

        initClient(node, client)
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
        this.pending = 0;
        this.wip = {};
        clearInterval(heartbeat);
        clearTimeout(timeoutID);
        this.server.releaseClient(client);
      });
    }

  function initClient(node, client){
    clearTimeout(timeoutID);
    init(node, client)
      .then(() => {
        setStatus(node, 'connected');
      })
      .catch((e) => {
        setStatus(node, 'error', e.toString());
        node.error(e);

        // retry
        timeoutID = setTimeout(function(){
          initClient(node, client);
        }, 3000);
      });

  }

	async function init(node, client) {

		if (!node.config.subjects) {
			node.error('require subjects');
			return;
		}

    // Preparing subjects
    let subjects = node.config.subjects.split(',');
    if (subjects.length == 0) {
			node.error('require subjects');
			return;
    }

		setStatus(node, 'initializing');

		// Ensure stream
    let targetStream = null;
		if (node.config.stream === 'ensure') {

			let streamNode = RED.nodes.getNode(node.config.ensurestream);

			if (!streamNode)
				throw new Error('No specific stream');

			node.log('Initializing stream ' + streamNode.config.stream);

			try {
				await client.ensureStream(streamNode.config.stream, streamNode.getOptions());
			} catch(e) {
        errMsg = 'failed to initialize stream'
        setStatus(node, 'error', errMsg);
				node.error(errMsg, e);
				throw e;
			}

      targetStream = streamNode.config.stream;
		}

		// Preparing consumer options
		let opts = {
      stream: targetStream || null,
			delivery: node.config.delivery || 'last',
			ack: node.config.ack || 'auto',
			startSeq: Number(node.config.startseq),
			startTime: new Date(Number(node.config.starttime) * 1000),
			ackWait: Number(node.config.ackwait),
      maxWorkerPending: Number(node.config.maxworkerpending) || 1000,
      maxDeliver: Number(node.config.maxDeliver) || -1,
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
			let sub = await client.subscribe(subjects, opts, (m) => {

        if (node.pending >= node.config.maxWorkerPending) {
          m.nak();
          return;
        }

        node.pending++;

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
					node.error(client.decode(m.data));
				}

				node.send(msg);

				// Sent acknoledgement automatically
				if (autoAck && !m.didAck) {
					m.ack();
					return;
				}
			});

			node.once('close', async () => {
        try {
          await sub.unsubscribe();
        } catch(e) {
          node.error('Failed to unsubscribe for ' + node.config.subjects);
        }
			});

		} catch(e) {
			node.error('Failed to subscribe for ' + node.config.subjects);
      setStatus(node, 'error', 'Failed to subscribe');
			throw e;
		}
	}

  function setStatus(node, type, message) {
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
          text: message || 'error'
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
