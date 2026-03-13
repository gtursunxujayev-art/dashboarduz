// VoIP (UTeL) integration service

export interface VoIPCallEvent {
  call_id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  status: 'ringing' | 'answered' | 'completed' | 'failed' | 'busy' | 'no-answer';
  start_time: string;
  end_time?: string;
  duration?: number;
  recording_url?: string;
  recording_id?: string;
  metadata?: {
    quality?: number;
    jitter?: number;
    packet_loss?: number;
    [key: string]: any;
  };
}

export interface VoIPConfig {
  apiToken: string;
  apiUrl: string;
}

export class VoIPService {
  private config: VoIPConfig;
  private baseUrl: string;

  constructor(config: VoIPConfig) {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.utel.uz';
  }

  // Make API request with authentication
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[VoIP] API error (${response.status}):`, errorText);
        throw new Error(`VoIP API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('[VoIP] Request error:', error);
      throw new Error(`VoIP API request failed: ${error.message}`);
    }
  }

  // Get call history
  async getCallHistory(params?: {
    start_date?: string;
    end_date?: string;
    direction?: 'inbound' | 'outbound';
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    calls: VoIPCallEvent[];
    total: number;
    page: number;
    limit: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.direction) queryParams.set('direction', params.direction);
    if (params?.status) queryParams.set('status', params.status);
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.limit) queryParams.set('limit', params.limit.toString());

    const endpoint = `/v1/calls${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  // Get specific call details
  async getCallDetails(callId: string): Promise<VoIPCallEvent> {
    return this.makeRequest(`/v1/calls/${callId}`);
  }

  // Make a call (click-to-call)
  async makeCall(from: string, to: string, options?: {
    caller_id?: string;
    timeout?: number;
    recording?: boolean;
    tags?: string[];
  }): Promise<{ call_id: string; status: string }> {
    const body = {
      from,
      to,
      ...options,
    };

    return this.makeRequest('/v1/calls/make', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Get call recording
  async getCallRecording(callId: string): Promise<{ url: string; format: string; duration: number }> {
    return this.makeRequest(`/v1/calls/${callId}/recording`);
  }

  // Get account balance
  async getAccountBalance(): Promise<{ balance: number; currency: string }> {
    return this.makeRequest('/v1/account/balance');
  }

  // Get account statistics
  async getAccountStats(params?: {
    start_date?: string;
    end_date?: string;
    group_by?: 'day' | 'week' | 'month';
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.group_by) queryParams.set('group_by', params.group_by);

    const endpoint = `/v1/account/stats${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  // Validate API token
  async validateToken(): Promise<boolean> {
    try {
      await this.getAccountBalance();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Process webhook event (called from webhook handler)
  processWebhookEvent(event: any): VoIPCallEvent | null {
    try {
      // Validate event structure
      if (!event.call_id || !event.direction || !event.from || !event.to || !event.status) {
        console.error('[VoIP] Invalid webhook event structure:', event);
        return null;
      }

      const callEvent: VoIPCallEvent = {
        call_id: event.call_id,
        direction: event.direction,
        from: event.from,
        to: event.to,
        status: event.status,
        start_time: event.start_time || new Date().toISOString(),
        end_time: event.end_time,
        duration: event.duration,
        recording_url: event.recording_url,
        recording_id: event.recording_id,
        metadata: event.metadata,
      };

      return callEvent;
    } catch (error) {
      console.error('[VoIP] Webhook processing error:', error);
      return null;
    }
  }

  // Search calls by phone number
  async searchCallsByPhone(phoneNumber: string, params?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<VoIPCallEvent[]> {
    const queryParams = new URLSearchParams();
    queryParams.set('phone', phoneNumber);
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.limit) queryParams.set('limit', params.limit.toString());

    const endpoint = `/v1/calls/search${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const result = await this.makeRequest(endpoint);
    return result.calls || [];
  }

  // Get call quality metrics
  async getCallQualityMetrics(callId: string): Promise<{
    quality: number;
    jitter: number;
    packet_loss: number;
    latency: number;
    mos: number;
  }> {
    return this.makeRequest(`/v1/calls/${callId}/quality`);
  }

  // Download call recording
  async downloadCallRecording(callId: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/v1/calls/${callId}/recording/download`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

// Factory function to create VoIP service instance
export function createVoIPService(config: VoIPConfig): VoIPService {
  return new VoIPService(config);
}
