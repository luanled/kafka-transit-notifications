// streamProcessor.js
const kafka = require('kafka-node');

class TransitStreamProcessor {
    constructor() {
        this.client = new kafka.KafkaClient({ 
            kafkaHost: 'kafka:29092',
            connectTimeout: 10000,
            requestTimeout: 30000
        });
        
        this.analytics = {
            delaysByLine: new Map(),
            incidentsByStop: new Map(),
            serviceHealth: new Map()
        };

        this.windowSize = 5 * 60 * 1000; // 5 minutes
        this.consumer = null;
        this.messageCount = 0;
        
        // Define topics to consume from
        this.topics = [
            { topic: 'transit-events-BLUE', partition: 0 },
            { topic: 'transit-events-GREEN', partition: 0 },
            { topic: 'transit-events-ORANGE', partition: 0 }
        ];
    }

    async start() {
        try {
            console.log('Starting stream processor for multiple topics...');
            
            // Create consumer with specific configs
            const consumer = new kafka.Consumer(
                this.client,
                this.topics,
                {
                    autoCommit: true,
                    autoCommitIntervalMs: 5000,
                    groupId: 'transit-stream-processor-group',
                    fromOffset: true
                }
            );

            this.consumer = consumer;

            // Add detailed event handlers
            consumer.on('message', (message) => {
                this.messageCount++;
                console.log(`Processing message #${this.messageCount} from topic ${message.topic}:`, message.value);
                this.processMessage(message);
            });

            consumer.on('error', (error) => {
                console.error('Stream processor consumer error:', error);
            });

            consumer.on('offsetOutOfRange', (error) => {
                console.error('Offset out of range:', error);
                // Reset offset to earliest
                consumer.setOffset(error.topic, error.partition, 0);
            });

            consumer.on('ready', () => {
                console.log('Stream processor consumer is ready');
                console.log('Consuming from topics:', this.topics.map(t => t.topic));
            });

            // Monitor processing status
            setInterval(() => {
                console.log('Current analytics state:', {
                    messageCount: this.messageCount,
                    delaysByLineCount: this.analytics.delaysByLine.size,
                    incidentsByStopCount: this.analytics.incidentsByStop.size,
                    serviceHealthCount: this.analytics.serviceHealth.size
                });
            }, 30000);

            console.log('Stream processor started successfully');
        } catch (error) {
            console.error('Failed to start stream processor:', error);
            throw error;
        }
    }

    processMessage(message) {
        try {
            const event = JSON.parse(message.value);
            console.log('Parsed event:', event);
            
            if (!event.eventType || !event.lineId) {
                console.warn('Invalid event format:', event);
                return;
            }

            // Process delays
            if (event.eventType === 'DELAY') {
                console.log('Processing delay event for line:', event.lineId);
                this.processDelay(event);
            }

            // Process incidents
            if (['DELAY', 'CANCELLATION'].includes(event.eventType)) {
                console.log('Processing incident event for stop:', event.stopId);
                this.processIncident(event);
            }

            // Update service health
            this.updateServiceHealth(event);

            // Log current state after processing
            console.log('Updated analytics state for lineId:', event.lineId);
        } catch (error) {
            console.error('Error processing message:', error);
            console.error('Raw message:', message);
        }
    }

    processDelay(event) {
        const currentStats = this.analytics.delaysByLine.get(event.lineId) || {
            avgDelay: 0,
            count: 0,
            delays: []
        };

        // Add new delay to the array
        currentStats.delays.push({
            delay: event.delayMinutes,
            timestamp: new Date(event.timestamp || Date.now())
        });

        // Remove delays older than window size
        const now = new Date();
        currentStats.delays = currentStats.delays.filter(d => 
            now - d.timestamp <= this.windowSize
        );

        // Calculate new average
        currentStats.avgDelay = currentStats.delays.reduce((sum, d) => 
            sum + d.delay, 0) / currentStats.delays.length || 0;
        
        currentStats.count = currentStats.delays.length;
        currentStats.lastUpdated = event.timestamp || new Date().toISOString();

        this.analytics.delaysByLine.set(event.lineId, currentStats);
        console.log(`Updated delays for line ${event.lineId}:`, currentStats);
    }

    processIncident(event) {
        const currentStats = this.analytics.incidentsByStop.get(event.stopId) || {
            count: 0,
            incidents: []
        };

        currentStats.incidents.push({
            type: event.eventType,
            timestamp: new Date(event.timestamp || Date.now())
        });

        // Remove incidents older than window size
        const now = new Date();
        currentStats.incidents = currentStats.incidents.filter(i => 
            now - i.timestamp <= this.windowSize
        );

        currentStats.count = currentStats.incidents.length;
        currentStats.lastIncident = event.timestamp || new Date().toISOString();

        this.analytics.incidentsByStop.set(event.stopId, currentStats);
        console.log(`Updated incidents for stop ${event.stopId}:`, currentStats);
    }

    updateServiceHealth(event) {
        const currentHealth = this.analytics.serviceHealth.get(event.lineId) || {
            healthScore: 100,
            events: []
        };

        const isHealthy = event.eventType !== 'CANCELLATION' && 
                         (event.eventType !== 'DELAY' || event.delayMinutes < 15);

        currentHealth.events.push({
            isHealthy,
            timestamp: new Date(event.timestamp || Date.now())
        });

        // Remove events older than window size
        const now = new Date();
        currentHealth.events = currentHealth.events.filter(e => 
            now - e.timestamp <= this.windowSize
        );

        // Calculate health score based on recent events
        const totalEvents = currentHealth.events.length;
        const healthyEvents = currentHealth.events.filter(e => e.isHealthy).length;
        
        currentHealth.healthScore = totalEvents > 0 
            ? (healthyEvents / totalEvents) * 100 
            : 100;
            
        currentHealth.lastUpdated = event.timestamp || new Date().toISOString();

        this.analytics.serviceHealth.set(event.lineId, currentHealth);
        console.log(`Updated health for line ${event.lineId}:`, currentHealth);
    }

    getAnalytics() {
        // Convert Maps to plain objects for API response
        const analytics = {
            delaysByLine: Object.fromEntries(this.analytics.delaysByLine),
            incidentsByStop: Object.fromEntries(this.analytics.incidentsByStop),
            serviceHealth: Object.fromEntries(this.analytics.serviceHealth)
        };

        console.log('Current analytics state:', analytics);
        return analytics;
    }

    async shutdown() {
        try {
            if (this.consumer) {
                await new Promise((resolve) => this.consumer.close(resolve));
            }
            await new Promise((resolve) => this.client.close(resolve));
            console.log('Stream processor shut down successfully');
        } catch (error) {
            console.error('Error during stream processor shutdown:', error);
            throw error;
        }
    }
}

module.exports = new TransitStreamProcessor();