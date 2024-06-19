const events = require('events');
const util = require('util');
const nats = require('nats');

module.exports = class Client extends events.EventEmitter {

	constructor(nc = null, opts = {}) {
		super();

		this.opts = Object.assign({
			servers: '0.0.0.0:32803',
			maxPingOut: 3,
			maxReconnectAttempts: -1,
			pingInterval: 10000,
		}, opts);
		this.status = 'disconnected';
		this.nc = nc;

		if (nc) {
			this.waitStatus();
		}
	}

	isInitialized() {
		return (this.nc) ? true : false;
	}

	clone() {
		return new Client(this.nc, this.opts);
	}

  compareArrary(arr1, arr2) {
    return arr1.length === arr2.length && arr1.every((v, i) => v === arr2[i]);
  }

	async connect() {
		let opts = {
			servers: this.opts.servers,
			maxPingOut: this.opts.maxPingOut,
			maxReconnectAttempts: this.opts.maxReconnectAttempts,
			pingInterval: this.opts.pingInterval,
		};

		this.nc = await nats.connect(opts);
		this.waitStatus();

		// Updating states
		this.status = 'connected';
		this.emit('connected');
	}

	async disconnect() {
		if (!this.nc)
			return;

		await this.nc.close();
	}

	async waitStatus() {
		try {
			for await (const s of this.nc.status()) {
				switch(s.type) {
				case nats.Events.Disconnect:
					this.status = 'disconnected';
					this.emit('disconnect');
					break;
				case nats.Events.Reconnect:
					this.status = 'reconnecting';
					this.emit('connected');
					break;
				case nats.DebugEvents.Reconnecting:
					this.status = 'reconnecting';
					this.emit('reconnect');
					break;
				}
			}
		} catch(e) {
			console.error(e);
		}
	}

	async createStream(streamName, opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		try {
      await jsm.streams.add(Object.assign(opts, {
        name: streamName,
      }));
    } catch(e) {
      throw e;
    }
	}

	async ensureStream(streamName, opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		try {
			let info = await jsm.streams.info(streamName)
		} catch(e) {

			// Not found
			if (e.code === '404') {
				console.log('creating new stream', streamName);
				return await this.createStream(streamName, opts);
			}

			throw e;
		}
	}

	async findStreamBySubject(subject) {

		let jsm = await this.nc.jetstreamManager();

    return await jsm.streams.find(subject)
	}

	async findStreamBySubjects(subjects = []) {

    let streamName = null;
    for (let subject of subjects) {
      streamName = await this.findStreamBySubject(subject)
      if (!streamName) {
        return null;
      }
    }

    return streamName;
	}

	async ensureConsumer(streamName, consumerName, opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		try {
			let info = await jsm.consumers.info(streamName, consumerName)

			// Check consumer confiuration or update
			let updated = false;
			for (let k in opts.config) {

        switch(k) {
        case 'name':
        case 'deliver_subject':
        case 'filter_subjects':
        case 'filter_subject':
            continue;
        }

				// Something's updated
				if (opts.config[k] != info.config[k]) {
          console.warn('consumer config(' + k + ') has changed', opts.config[k], info.config[k]);
					info.config[k] = opts.config[k];
					updated = true;
				}
			}

      // Check filters
      let origFilters = info.config.filter_subjects || [ info.config.filter_subject ];
      if (!this.compareArrary(opts.filters, origFilters)) {

        if (opts.filters.length == 1) {
          info.config.filter_subject = opts.filters[0];
          info.config.filter_subjects = undefined;
        } else {
          info.config.filter_subject = undefined;
          info.config.filter_subjects = opts.filters;
        }

        console.warn('consumer config(filter_subjects) has changed', origFilters, 'to', opts.filters);
        updated = true;
      }

			if (updated) {
				console.warn('updating consumer', consumerName);
				await jsm.consumers.update(streamName, consumerName, info.config);
			}
			
		} catch(e) {

			if (e.code !== '404') {
        throw e;
      }

			// Not found
      opts.durable(consumerName);

      let cOpts = opts.getOpts();

      // Not found, so trying to create consumer
      console.log('creating new consumer', consumerName, cOpts.config.filter_subjects || cOpts.config.deliver_subject);

      await jsm.consumers.add(streamName, cOpts.config);
      console.log('consumer was created', consumerName);
		}
	}

	async publish(subject, payload) {

		let js = this.nc.jetstream();

		await js.publish(subject, payload);
	}

	async publishString(subject, payload) {

		let js = this.nc.jetstream();
		let sc = nats.StringCodec();

		await js.publish(subject, sc.encode(payload));
	}

	async publishJSON(subject, payload = {}) {

		let js = this.nc.jetstream();
		let sc = nats.JSONCodec();

		await js.publish(subject, sc.encode(payload));
	}

	decode(data) {
		let sc = nats.StringCodec();

		return sc.decode(data);
	}

	async subscribe(subjects = [], opts = {}, callback) {

		// Preparing consumer options
		let cOpts = nats.consumerOpts();
		cOpts.deliverTo(nats.createInbox());

    if (!Array.isArray(subjects)) {
      subjects = [subjects];
    }

    if (subjects.length === 0) {
      throw new Error('no subject has specified');
    }

    subjects.forEach((subject) => {
      cOpts.filterSubject(subject);
    });

		switch(opts.ack) {
		case 'auto':
			cOpts.ackNone();
			break;
		case 'all':
			cOpts.ackAll();
			break;
		case 'manual':
			cOpts.ackExplicit();
			cOpts.manualAck();
			break;
		}

		switch(opts.delivery) {
		case 'last':
			cOpts.deliverLast();
			break;
		case 'new':
			cOpts.deliverNew();
			break;
		case 'all':
			cOpts.deliverAll();
			break;
		case 'lastPerSubject':
			cOpts.deliverLastPerSubject();
			break;
		case 'startSeq':
			cOpts.startSequence(opts.startSeq || 1);
			break;
		case 'startTime':
			cOpts.startTime(opts.startTime || new Date());
			break;
		}

    if (opts.maxDeliver > 0) {
      cOpts.maxDeliver(opts.maxDeliver);
    }

    if (!opts.queue) {
      cOpts.flowControl();
      cOpts.idleHeartbeat(5000);
    }

		if (opts.ackWait) {
			cOpts.ackWait(opts.ackWait || 10000);
		}

		if (opts.maxAckPending) {
			cOpts.maxAckPending(opts.maxAckPending || 2000);
		}

		if (opts.durable) {
			cOpts.durable(opts.durable);
		}

		if (opts.queue && opts.durable) {
			cOpts.queue(opts.durable);

			// Find stream by subject
      let stream = await this.findStreamBySubjects(subjects);
      if (!stream) {
        throw new Error('no stream has specified subject');
      }

			// ensure consumer
			await this.ensureConsumer(stream, opts.durable, cOpts);
		}

		// Subscribe
		let js = this.nc.jetstream();
		let sub = await js.subscribe(subjects[0], cOpts);

		(async () => {
			for await (const m of sub) {
				callback(m);
			}
		})()

		return sub;
	}
}
