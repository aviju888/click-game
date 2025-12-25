import { redis } from './redis';

export type Team = 'A' | 'B';

/**
 * Assigns a team based on IP address hash
 * Simple hash: sum of IP octets, modulo 2
 */
export function assignTeamFromIP(ip: string): Team {
  // Handle IPv4 addresses
  const octets = ip.split('.').map(octet => parseInt(octet, 10));
  if (octets.length === 4 && octets.every(o => !isNaN(o))) {
    const hash = octets.reduce((acc, octet) => acc + octet, 0);
    return hash % 2 === 0 ? 'A' : 'B';
  }

  // Fallback for other IP formats (IPv6, etc.)
  // Simple hash of the string
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 2 === 0 ? 'A' : 'B';
}

/**
 * Gets or assigns a team for a client ID
 * Team assignment is permanent once set
 */
export async function getOrAssignTeam(
  clientId: string,
  ip: string
): Promise<Team> {
  // Check if team is already assigned
  const existingTeam = await redis.get<string>(`team:${clientId}`);
  
  if (existingTeam === 'A' || existingTeam === 'B') {
    return existingTeam;
  }

  // Assign new team based on IP
  const team = assignTeamFromIP(ip);
  await redis.set(`team:${clientId}`, team);

  return team;
}

/**
 * Gets the team for a client ID (returns null if not assigned)
 */
export async function getTeam(clientId: string): Promise<Team | null> {
  const team = await redis.get<string>(`team:${clientId}`);
  if (team === 'A' || team === 'B') {
    return team;
  }
  return null;
}

