// Secret management abstraction for AWS Secrets Manager / HashiCorp Vault

export interface SecretsManager {
  getSecret(secretName: string): Promise<string | Record<string, any>>;
  setSecret(secretName: string, secretValue: string | Record<string, any>): Promise<void>;
  rotateSecret(secretName: string): Promise<void>;
}

// AWS Secrets Manager implementation
class AWSSecretsManager implements SecretsManager {
  private client: any;

  constructor() {
    // In production, initialize AWS SDK
    // const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
    // this.client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  }

  async getSecret(secretName: string): Promise<string | Record<string, any>> {
    try {
      // In production, use AWS SDK
      // const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretName }));
      // return JSON.parse(response.SecretString || '{}');
      
      // For now, return from environment or throw
      const envKey = secretName.toUpperCase().replace(/\//g, '_').replace(/-/g, '_');
      const value = process.env[envKey];
      
      if (!value) {
        throw new Error(`Secret ${secretName} not found`);
      }
      
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error: any) {
      console.error(`[SecretsManager] Failed to get secret ${secretName}:`, error.message);
      throw error;
    }
  }

  async setSecret(secretName: string, secretValue: string | Record<string, any>): Promise<void> {
    try {
      // In production, use AWS SDK
      // const secretString = typeof secretValue === 'string' ? secretValue : JSON.stringify(secretValue);
      // await this.client.send(new PutSecretValueCommand({
      //   SecretId: secretName,
      //   SecretString: secretString,
      // }));
      
      console.log(`[SecretsManager] Secret ${secretName} would be set (not implemented in dev mode)`);
    } catch (error: any) {
      console.error(`[SecretsManager] Failed to set secret ${secretName}:`, error.message);
      throw error;
    }
  }

  async rotateSecret(secretName: string): Promise<void> {
    try {
      // In production, trigger rotation
      // await this.client.send(new RotateSecretCommand({ SecretId: secretName }));
      
      console.log(`[SecretsManager] Secret ${secretName} would be rotated (not implemented in dev mode)`);
    } catch (error: any) {
      console.error(`[SecretsManager] Failed to rotate secret ${secretName}:`, error.message);
      throw error;
    }
  }
}

// HashiCorp Vault implementation
class VaultSecretsManager implements SecretsManager {
  private vaultUrl: string;
  private token: string;

  constructor() {
    this.vaultUrl = process.env.VAULT_ADDR || 'http://localhost:8200';
    this.token = process.env.VAULT_TOKEN || '';
  }

  async getSecret(secretName: string): Promise<string | Record<string, any>> {
    try {
      // In production, use Vault API
      // const response = await fetch(`${this.vaultUrl}/v1/secret/data/${secretName}`, {
      //   headers: { 'X-Vault-Token': this.token },
      // });
      // const data = await response.json();
      // return data.data.data;
      
      // For now, return from environment
      const envKey = secretName.toUpperCase().replace(/\//g, '_').replace(/-/g, '_');
      return process.env[envKey] || {};
    } catch (error: any) {
      console.error(`[Vault] Failed to get secret ${secretName}:`, error.message);
      throw error;
    }
  }

  async setSecret(secretName: string, secretValue: string | Record<string, any>): Promise<void> {
    try {
      // In production, use Vault API
      // const secretData = typeof secretValue === 'string' 
      //   ? { value: secretValue } 
      //   : secretValue;
      // await fetch(`${this.vaultUrl}/v1/secret/data/${secretName}`, {
      //   method: 'POST',
      //   headers: { 'X-Vault-Token': this.token, 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ data: secretData }),
      // });
      
      console.log(`[Vault] Secret ${secretName} would be set (not implemented in dev mode)`);
    } catch (error: any) {
      console.error(`[Vault] Failed to set secret ${secretName}:`, error.message);
      throw error;
    }
  }

  async rotateSecret(secretName: string): Promise<void> {
    // Vault doesn't have built-in rotation, but you can implement custom logic
    console.log(`[Vault] Secret ${secretName} rotation not implemented`);
  }
}

// Factory function
export function getSecretsManager(): SecretsManager {
  const provider = process.env.SECRETS_PROVIDER || 'aws';
  
  switch (provider) {
    case 'vault':
      return new VaultSecretsManager();
    case 'aws':
    default:
      return new AWSSecretsManager();
  }
}

// Helper to load secrets into environment
export async function loadSecretsFromManager(secretNames: string[]): Promise<void> {
  const manager = getSecretsManager();
  
  for (const secretName of secretNames) {
    try {
      const secret = await manager.getSecret(secretName);
      
      if (typeof secret === 'object') {
        // Load object secrets as individual environment variables
        Object.entries(secret).forEach(([key, value]) => {
          process.env[key.toUpperCase()] = String(value);
        });
      } else {
        // Load string secret
        const envKey = secretName.toUpperCase().replace(/\//g, '_').replace(/-/g, '_');
        process.env[envKey] = secret;
      }
    } catch (error: any) {
      console.warn(`[SecretsManager] Failed to load secret ${secretName}:`, error.message);
    }
  }
}

// Secret rotation schedule
export interface SecretRotationConfig {
  secretName: string;
  rotationIntervalDays: number;
  lastRotated?: Date;
}

export const secretRotationConfigs: SecretRotationConfig[] = [
  { secretName: 'database/password', rotationIntervalDays: 90 },
  { secretName: 'jwt/secret', rotationIntervalDays: 90 },
  { secretName: 'encryption/key', rotationIntervalDays: 365 },
  { secretName: 'oauth/google/client_secret', rotationIntervalDays: 180 },
  { secretName: 'oauth/amocrm/client_secret', rotationIntervalDays: 180 },
];

// Check if secrets need rotation
export async function checkSecretRotation(): Promise<Array<{ secret: string; daysOverdue: number }>> {
  const manager = getSecretsManager();
  const overdue: Array<{ secret: string; daysOverdue: number }> = [];
  
  for (const config of secretRotationConfigs) {
    if (config.lastRotated) {
      const daysSinceRotation = Math.floor(
        (Date.now() - config.lastRotated.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysSinceRotation > config.rotationIntervalDays) {
        overdue.push({
          secret: config.secretName,
          daysOverdue: daysSinceRotation - config.rotationIntervalDays,
        });
      }
    } else {
      // Never rotated, mark as overdue
      overdue.push({
        secret: config.secretName,
        daysOverdue: config.rotationIntervalDays,
      });
    }
  }
  
  return overdue;
}
