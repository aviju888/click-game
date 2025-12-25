'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Ably from 'ably';
import { track } from '@vercel/analytics';

type Team = 'A' | 'B';

interface CounterData {
  counters: [number, number, number];
  teamScore: number;
  votesRemaining: number;
  team?: Team;
}

interface VoteLog {
  id: number;
  counterId: number;
  delta: number;
  timestamp: string;
}

interface PendingVote {
  counterId: 1 | 2 | 3;
  delta: 1 | -1;
}

interface GlobalVote {
  counterId: number;
  delta: number;
  team: Team;
  timestamp: number;
}

// Icons
const DiceIcon = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const CrownIcon = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
  </svg>
);


export default function CounterGame() {
  const [counters, setCounters] = useState<[number, number, number]>([0, 0, 0]);
  const [teamScore, setTeamScore] = useState(0);
  const [votesRemaining, setVotesRemaining] = useState(3);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [timeUntilReset, setTimeUntilReset] = useState('');
  
  // UI State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ablyConnected, setAblyConnected] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [voteHistory, setVoteHistory] = useState<VoteLog[]>([]);
  const [lastGlobalVote, setLastGlobalVote] = useState<GlobalVote | null>(null);
  const [activeLogTab, setActiveLogTab] = useState<'local' | 'global'>('local');
  
  // Statistics State
  const [stats, setStats] = useState({
    totalVotes: 0,
    totalUsers: 0,
    teamAUsers: 0,
    teamBUsers: 0,
  });
  
  // Online Count State
  const [onlineCount, setOnlineCount] = useState(0);
  
  // Admin Stats State
  const [adminStats, setAdminStats] = useState({
    onlineCount: 0,
    onlineTeamA: 0,
    onlineTeamB: 0,
    votesTodayTeamA: 0,
    votesTodayTeamB: 0,
    votesAllTimeTeamA: 0,
    votesAllTimeTeamB: 0,
    voteRate: 0, // votes per minute
  });
  
  // Random Vote State
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [pendingRandomVotes, setPendingRandomVotes] = useState<PendingVote[]>([]);
  
  // Loading State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Refresh cooldown state
  const [refreshClickCount, setRefreshClickCount] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  
  // Admin State
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showWinnerTest, setShowWinnerTest] = useState(false);

  // Cooldown countdown timer - force re-render every second during cooldown
  const [cooldownDisplay, setCooldownDisplay] = useState(0);
  useEffect(() => {
    if (cooldownUntil > Date.now()) {
      const interval = setInterval(() => {
        const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
        setCooldownDisplay(remaining);
        if (Date.now() >= cooldownUntil) {
          setCooldownUntil(0);
          setRefreshClickCount(0);
          setCooldownDisplay(0);
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      setCooldownDisplay(0);
    }
  }, [cooldownUntil]);

  // Countdown Timer Logic
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(now.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      
      const diff = tomorrow.getTime() - now.getTime();
      
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeUntilReset(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
    };

    const timerId = setInterval(updateTimer, 1000);
    updateTimer(); // Initial call

    return () => clearInterval(timerId);
  }, []);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (errorMessage || successMessage) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
        setSuccessMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage, successMessage]);

  // Check admin status on load
  const checkAdminStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/auth');
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.authenticated);
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    }
  }, []);

  // Fetch initial data
  const fetchCounters = useCallback(async () => {
    try {
      // Add cache busting to ensure fresh data after vote reset
      const response = await fetch(`/api/counters?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch counters');
      }
      const data: CounterData = await response.json();
      setCounters(data.counters);
      setTeamScore(data.teamScore);
      setVotesRemaining(data.votesRemaining);
      if (data.team) {
        setUserTeam(data.team);
      } else {
        setUserTeam((prev) => prev || 'A'); // Default fallback only if not set
      }
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching counters:', error);
      setErrorMessage('Failed to load counters. Please refresh the page.');
      setIsLoading(false);
    }
  }, []);

  // Ably Setup
  useEffect(() => {
    let ablyClient: Ably.Realtime | null = null;
    let channel: Ably.RealtimeChannel | null = null;

    const initAbly = async () => {
      try {
        ablyClient = new Ably.Realtime({
          authCallback: async (tokenParams: any, callback: any) => {
            try {
              const response = await fetch('/api/ably/token', { method: 'POST' });
              if (!response.ok) {
                throw new Error('Failed to get Ably token');
              }
              const tokenRequest = await response.json();
              callback(null, tokenRequest);
            } catch (err) {
              callback(err as Error, null);
            }
          },
        });

        ablyClient.connection.on('connected', () => {
          setAblyConnected(true);
        });
        ablyClient.connection.on('disconnected', () => {
          setAblyConnected(false);
          setOnlineCount(0);
        });

        channel = ablyClient.channels.get('global-counter');
        
        // Subscribe to counter updates
        channel.subscribe('update', (message: any) => {
          const data = message.data;
          if (data) {
          setCounters(data.counters);
          setTeamScore(data.teamScore);
            // Update last global vote if included in message
            if (data.lastVote) {
              setLastGlobalVote(data.lastVote);
            }
            // If vote reset signal, refresh vote counts
            if (data.voteReset) {
              fetchCounters();
            }
          }
        });
        
        // Subscribe to presence events for online count
        const updateOnlineCount = async () => {
          try {
            const members = await channel.presence.get();
            const total = members.length;
            const teamA = members.filter((m: any) => m.data?.team === 'A').length;
            const teamB = members.filter((m: any) => m.data?.team === 'B').length;
            setOnlineCount(total);
            // Update admin stats if admin
            setAdminStats(prev => ({
              ...prev,
              onlineCount: total,
              onlineTeamA: teamA,
              onlineTeamB: teamB,
            }));
          } catch (error) {
            // Silently fail
          }
        };
        
        channel.presence.subscribe(['enter', 'leave', 'update'], () => {
          updateOnlineCount();
        });
        
        // Get initial presence count after connection
        ablyClient.connection.once('connected', async () => {
          if (userTeam && channel) {
            await channel.presence.enter({ team: userTeam });
          }
          updateOnlineCount();
        });
        
        // Also try to get initial count if already connected
        if (ablyClient.connection.state === 'connected') {
          if (userTeam) {
            channel.presence.enter({ team: userTeam }).then(() => {
              updateOnlineCount();
            });
          } else {
            updateOnlineCount();
          }
        }
      } catch (error) {
        console.error('Error initializing Ably:', error);
        setAblyConnected(false);
      }
    };

    initAbly();
    fetchCounters();
    checkAdminStatus();

    // Fetch initial last vote
    const fetchLastVote = async () => {
      try {
        const response = await fetch('/api/last-vote');
        if (response.ok) {
          const data = await response.json();
          setLastGlobalVote(data.lastVote);
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    // Fetch statistics
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    fetchLastVote();
    fetchStats();
    
    // Fetch admin stats function
    const fetchAdminStats = async () => {
      if (!isAdmin) return;
      try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
          const data = await response.json();
          // Merge with existing online counts (from presence)
          setAdminStats(prev => ({
            ...prev,
            ...data,
            // Preserve online counts from presence
            onlineCount: prev.onlineCount,
            onlineTeamA: prev.onlineTeamA,
            onlineTeamB: prev.onlineTeamB,
          }));
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    // Fetch admin stats if admin
    if (isAdmin) {
      fetchAdminStats();
    }
    
    // Refresh stats periodically
    const statsInterval = setInterval(() => {
      fetchStats();
      if (isAdmin) {
        fetchAdminStats();
      }
    }, 5000); // Every 5 seconds

    return () => {
      clearInterval(statsInterval);
      if (channel) {
        channel.presence.leave().catch(() => {});
        channel.unsubscribe();
      }
      ablyClient?.close();
    };
  }, [fetchCounters, checkAdminStatus, userTeam, isAdmin]);

  // Actions
  const handleAdminLogin = async () => {
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });

      if (response.ok) {
        setIsAdmin(true);
        setShowAdminLogin(false);
        setAdminPassword('');
        setVotesRemaining(999);
        setSuccessMessage('ADMIN ACCESS GRANTED');
        
        // Fetch admin stats immediately
        try {
          const statsResponse = await fetch('/api/admin/stats');
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            // Merge with existing online counts (from presence)
            setAdminStats(prev => ({
              ...prev,
              ...statsData,
              // Preserve online counts from presence
              onlineCount: prev.onlineCount,
              onlineTeamA: prev.onlineTeamA,
              onlineTeamB: prev.onlineTeamB,
            }));
          }
        } catch (error) {
          // Silently fail
        }
      } else {
        setErrorMessage('ACCESS DENIED');
      }
    } catch {
      setErrorMessage('SYSTEM ERROR');
    }
  };

  const handleAdminLogout = async () => {
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'DELETE',
      });

      if (response.ok) {
        setIsAdmin(false);
        setSuccessMessage('ADMIN LOGGED OUT');
        // Refresh to get real vote count
        fetchCounters();
        
        // Track admin logout
        track('admin_logout', { success: 'true' });
      } else {
        setErrorMessage('LOGOUT FAILED');
        track('admin_logout', { success: 'false' });
      }
    } catch {
      setErrorMessage('SYSTEM ERROR');
      track('admin_logout', { success: 'error' });
    }
  };

  const handleReset = async (type: 'counters' | 'votes' | 'all') => {
    if (!confirm(`RESET ${type.toUpperCase()}?`)) return;
    try {
      const response = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (response.ok) {
        setSuccessMessage(`${type.toUpperCase()} RESET SUCCESSFUL`);
        // Force refresh vote counts immediately
        if (type === 'votes' || type === 'all') {
          // Small delay to ensure Redis deletion is complete
          setTimeout(() => {
            fetchCounters();
          }, 100);
        } else {
          fetchCounters();
        }
        
        // Track admin reset
        track('admin_reset', { type });
        
        // Refresh stats after reset
        const fetchStats = async () => {
          try {
            const response = await fetch('/api/stats');
      if (response.ok) {
        const data = await response.json();
              setStats(data);
            }
          } catch (error) {
            // Silently fail
          }
        };
        fetchStats();
      } else {
        setErrorMessage('RESET FAILED');
        track('admin_reset', { type, success: 'false' });
      }
    } catch {
      setErrorMessage('RESET FAILED');
      track('admin_reset', { type, success: 'error' });
    }
  };

  const handleClick = async (counterId: 1 | 2 | 3, delta: 1 | -1) => {
    if (isSubmitting) return; // Prevent rapid clicks
    
    if (!isAdmin && votesRemaining <= 0) {
      setErrorMessage(`WAIT: ${timeUntilReset}`);
      return;
    }

    // Track vote click
    track('vote_click', {
      counterId,
      delta,
      team: userTeam || 'unknown',
      isAdmin: isAdmin.toString(),
      votesRemaining: votesRemaining,
    });

    setIsSubmitting(true);

    // Record local history
    const now = new Date();
    setVoteHistory(prev => [{
      id: Date.now(),
      counterId,
      delta,
      timestamp: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    }, ...prev]);

    // Optimistic update
    const newCounters = [...counters];
    newCounters[counterId - 1] += delta;
    setCounters(newCounters as [number, number, number]);
    if (!isAdmin) setVotesRemaining((prev) => Math.max(0, prev - 1));

    try {
      const response = await fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterId, delta }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setErrorMessage('VOTE LIMIT REACHED');
          setVotesRemaining(0);
        } else {
          setErrorMessage(data.error || 'VOTE FAILED');
        }
        // Revert optimistic update on error
        fetchCounters();
        setIsSubmitting(false);
        return;
      }

      setCounters(data.counters);
      setTeamScore(data.teamScore);
      setVotesRemaining(data.votesRemaining);
      if (data.team) setUserTeam(data.team);
      
      // Refresh stats after successful vote
      const fetchStats = async () => {
        try {
          const response = await fetch('/api/stats');
          if (response.ok) {
            const data = await response.json();
            setStats(data);
          }
        } catch (error) {
          // Silently fail
        }
      };
      fetchStats();
      
    } catch (error) {
      // Revert optimistic update on error
      setErrorMessage('NETWORK ERROR - TRY AGAIN');
      fetchCounters();
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateRandomVotes = () => {
    if (votesRemaining < 3 && !isAdmin) {
      setErrorMessage('NEED 3 VOTES TO RANDOMIZE');
      return;
    }

    const newVotes: PendingVote[] = [];
    for (let i = 0; i < 3; i++) {
      const counterId = (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3;
      const delta = Math.random() > 0.5 ? 1 : -1;
      newVotes.push({ counterId, delta });
    }
    setPendingRandomVotes(newVotes);
    setShowRandomModal(true);
  };

  const confirmRandomVotes = async () => {
    setShowRandomModal(false);
    setIsSubmitting(true);
    
    let successCount = 0;
    let failCount = 0;
    
    // Execute all 3 votes sequentially
    for (const vote of pendingRandomVotes) {
      try {
        const response = await fetch('/api/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ counterId: vote.counterId, delta: vote.delta }),
        });

        if (response.ok) {
          const data = await response.json();
          setCounters(data.counters);
          setTeamScore(data.teamScore);
          setVotesRemaining(data.votesRemaining);
          if (data.team) setUserTeam(data.team);
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
      
      // Small delay for effect
      await new Promise(r => setTimeout(r, 200));
    }
    
    setIsSubmitting(false);
    
    // Record all votes in history
    const now = new Date();
    pendingRandomVotes.forEach(vote => {
      setVoteHistory(prev => [{
        id: Date.now() + Math.random(),
        counterId: vote.counterId,
        delta: vote.delta,
        timestamp: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
      }, ...prev]);
    });
    
    // Refresh to get accurate state
    await fetchCounters();
    
    // Track random vote completion
    track('random_vote_completed', {
      successCount,
      failCount,
      team: userTeam || 'unknown',
    });

    if (failCount === 0) {
      setSuccessMessage('RANDOM CHAOS UNLEASHED');
    } else if (successCount > 0) {
      setErrorMessage(`PARTIAL SUCCESS: ${successCount}/3 VOTES`);
    } else {
      setErrorMessage('ALL RANDOM VOTES FAILED');
    }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-200 font-mono text-xl">LOADING SYSTEM...</div>;

  const isTeamA = userTeam === 'A';
  const isTeamB = userTeam === 'B';
  const isDisabled = (!isAdmin && votesRemaining === 0) || isSubmitting;
  
  // Tug of War logic
  const maxScoreReference = 500;
  const rawPercentage = (teamScore / maxScoreReference) * 50; 
  const indicatorPosition = Math.min(Math.max(50 + rawPercentage, 5), 95);
  
  // Calculate winning team
  const winningTeam = teamScore > 0 ? 'A' : teamScore < 0 ? 'B' : 'TIE';
  
  // Calculate individual team scores
  const teamAScore = Math.max(0, teamScore);
  const teamBScore = Math.abs(Math.min(0, teamScore));

  return (
    <div className="min-h-screen w-full bg-[#c0c0c0] flex flex-col items-center py-8 px-4 font-mono text-black border-8 border-gray-400 relative">
      
      {/* Toast */}
      {(errorMessage || successMessage) && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${errorMessage ? 'bg-red-500 text-white' : 'bg-green-500 text-black'}`}>
          <span className="font-bold uppercase">{errorMessage || successMessage}</span>
          </div>
        )}

      {/* Winner Test Modal */}
      {showWinnerTest && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black p-6 w-full max-w-md shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-scale-in">
            <h3 className="text-xl font-black uppercase mb-4 text-center border-b-2 border-black pb-2">
              WINNER TEST PREVIEW
            </h3>
            
            <div className="space-y-4 mb-6">
              {/* Test Team A Winner */}
              <div 
                className="w-full border-2 border-black flex items-center justify-between p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-blue-600 text-white"
              >
                <div className="flex items-center gap-3 font-black uppercase tracking-wider">
                  <div className="w-8 h-8 flex items-center justify-center">
                    <CrownIcon />
                  </div>
                  <div className="flex flex-col items-start leading-none gap-1">
                    <span className="text-[10px] text-white/80">YESTERDAY'S CHAMPION</span>
                    <span className="text-xl drop-shadow-sm">
                      TEAM A <span className="opacity-80 text-sm font-medium">(+1420)</span>
          </span>
                  </div>
                </div>
        </div>

              {/* Test Team B Winner */}
              <div 
                className="w-full border-2 border-black flex items-center justify-between p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-red-600 text-white"
              >
                <div className="flex items-center gap-3 font-black uppercase tracking-wider">
                  <div className="w-8 h-8 flex items-center justify-center">
                    <CrownIcon />
                  </div>
                  <div className="flex flex-col items-start leading-none gap-1">
                    <span className="text-[10px] text-white/80">YESTERDAY'S CHAMPION</span>
                    <span className="text-xl drop-shadow-sm">
                      TEAM B <span className="opacity-80 text-sm font-medium">(-2100)</span>
          </span>
                  </div>
                </div>
              </div>
              
              {/* Test Tie Scenario */}
              <div 
                className="w-full border-2 border-black flex items-center justify-between p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-gray-100 text-gray-500"
              >
                <div className="flex items-center gap-3 font-black uppercase tracking-wider">
                  <div className="flex flex-col items-start leading-none gap-1">
                    <span className="text-[10px] text-gray-400">YESTERDAY'S CHAMPION</span>
                    <span className="text-xl">TIE (0)</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="text-xs text-gray-500 mb-4 p-2 bg-gray-50 border border-black">
              <p className="font-bold mb-1">TEST SCENARIOS:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Team A winning (blue banner)</li>
                <li>Team B winning (red banner)</li>
                <li>Tie scenario (gray banner)</li>
              </ul>
        </div>

            <button
              onClick={() => {
                setShowWinnerTest(false);
                track('admin_test_winner', { action: 'close' });
              }}
              className="w-full bg-black text-white border-2 border-black py-2 font-bold hover:bg-gray-800 active:bg-gray-900"
            >
              CLOSE
                </button>
              </div>
          </div>
        )}

      {/* Random Vote Modal */}
      {showRandomModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black p-6 w-full max-w-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-scale-in">
            <h3 className="text-xl font-black uppercase mb-4 text-center border-b-2 border-black pb-2">
              CONFIRM CHAOS?
            </h3>
            <div className="space-y-3 mb-6">
              {pendingRandomVotes.map((vote, i) => (
                <div key={i} className="flex justify-between items-center bg-gray-100 p-2 border-2 border-black">
                  <span className="font-bold">VOTE {i + 1}</span>
                  <span>CNTR_0{vote.counterId}</span>
                  <span className={`font-black ${vote.delta > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {vote.delta > 0 ? '+1 UP' : '-1 DOWN'}
          </span>
        </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRandomModal(false)}
                className="flex-1 border-2 border-black py-2 font-bold hover:bg-gray-200 active:bg-gray-300"
              >
                DECLINE
              </button>
              <button
                onClick={confirmRandomVotes}
                className="flex-1 bg-black text-white border-2 border-black py-2 font-bold hover:bg-gray-800 active:bg-gray-900"
              >
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="w-full max-w-3xl bg-white border-2 border-black p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.5)]">
        
        {/* Minimal Header */}
        <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-4">
          <div className="flex flex-col">
            <h1 className="text-3xl font-black uppercase tracking-tight leading-none">CLICK_WARS</h1>
            <span className="text-[10px] text-gray-500 font-bold mt-1">DAILY BATTLE ENDS IN: {timeUntilReset}</span>
          </div>
          
          <div className="flex gap-2">
              <button
              onClick={generateRandomVotes}
              disabled={isDisabled || isSubmitting || (!isAdmin && votesRemaining < 3)}
              title="Randomize My Votes"
              className="group w-10 h-10 flex items-center justify-center border-2 border-black bg-purple-200 hover:bg-purple-100 font-bold hover:translate-x-[1px] hover:translate-y-[1px] active:bg-purple-300 active:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed text-black"
            >
              <DiceIcon className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:[transform:perspective(500px)_rotate3d(1,1,0,45deg)_scale(1.1)]" />
              </button>
            <button 
              onClick={() => {
                setShowHelp(!showHelp);
                track('help_toggle', { open: (!showHelp).toString() });
              }}
              title="Help"
              className="w-10 h-10 flex items-center justify-center border-2 border-black bg-gray-200 hover:bg-white font-bold hover:translate-x-[1px] hover:translate-y-[1px] active:bg-black active:text-white transition-all text-xl"
            >
              ?
              </button>
            </div>
        </div>

        {/* Help Panel */}
        {showHelp && (
          <div className="mb-6 p-4 bg-yellow-100 border-2 border-black text-sm">
            <p className="font-bold mb-2">:: SYSTEM_INFO ::</p>
            <ul className="list-disc pl-4 space-y-1 mb-4">
              <li>Global tug-of-war experiment.</li>
              <li><span className="text-blue-600 font-bold">TEAM A</span> pushes numbers <span className="text-blue-600 font-bold">UP (+)</span>.</li>
              <li><span className="text-red-600 font-bold">TEAM B</span> pushes numbers <span className="text-red-600 font-bold">DOWN (-)</span>.</li>
              <li>You get <span className="font-bold">3 VOTES</span> per day.</li>
              <li>Use the Traitor button below to sabotage your own team.</li>
              <li>Use the Dice button to randomize all 3 votes (Chaos Mode).</li>
              <li>Winner is declared daily at UTC Midnight.</li>
            </ul>
            <p className="text-xs text-gray-500 border-t border-black/20 pt-2">
              Made For Fun by <a href="https://www.linkedin.com/in/adriel-vijuan/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">Adriel V.</a>
            </p>
          </div>
        )}

        {/* Minimal Scoreboard */}
        <div className="bg-gray-100 border-2 border-black p-4 mb-8 text-center relative">
          {/* The Bar */}
          <div className="relative mb-4">
            {/* Team Labels with Scores */}
            <div className="flex justify-between items-start mb-1">
              <div className="flex flex-col items-start">
                <span className="text-blue-600 text-xs font-black uppercase">TEAM A</span>
                <span className="text-blue-600 text-lg font-bold">+{teamAScore}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-red-600 text-xs font-black uppercase">TEAM B</span>
                <span className="text-red-600 text-lg font-bold">-{teamBScore}</span>
              </div>
            </div>
            
            <div className="h-6 w-full border-2 border-black relative flex items-center overflow-hidden">
              {/* Team A Side (Blue) - Left Half */}
              <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-blue-300 z-0"></div>
              
              {/* Team B Side (Red) - Right Half */}
              <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-red-300 z-0"></div>
              
              {/* Center Line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-black/40 z-0"></div>
              
              {/* Moving Indicator */}
              <div 
                className="absolute top-0 bottom-0 w-2 bg-black border-x border-white z-10 transition-all duration-500 ease-out"
                style={{ left: `${indicatorPosition}%` }}
              ></div>
              
              {/* Winning Indicator */}
              {winningTeam !== 'TIE' && (
                <div 
                  className={`absolute top-0 -mt-8 left-1/2 transform -translate-x-1/2 z-20 px-2 py-1 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-xs font-black uppercase transition-all duration-500 ease-out ${
                    winningTeam === 'A' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-red-600 text-white'
                  }`}
                  style={{ left: `${indicatorPosition}%`, transform: `translate(-50%, 0)` }}
                >
                  WINNING: TEAM {winningTeam}
                </div>
              )}
            </div>
          </div>
          
          {/* Main Score Display */}
          <div className="flex justify-center items-center gap-4">
            <div className="bg-white border-2 border-black px-6 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
              <span className={`text-4xl font-black ${teamScore > 0 ? 'text-blue-600' : teamScore < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                {teamScore > 0 ? '+' : ''}{teamScore}
              </span>
            </div>
          </div>

          {/* Simplified Team Indicator */}
          <div className={`mt-4 ${isTeamA ? 'text-blue-600' : 'text-red-600'}`}>
            <div className="font-black uppercase tracking-widest text-xl">
              YOU ARE TEAM {userTeam || '?'}
            </div>
            <div className="text-xs font-normal mt-1 opacity-80">
              YOUR GOAL: {userTeam === 'A' ? 'INCREASE' : userTeam === 'B' ? 'DECREASE' : '?'} THE SCORE
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex justify-between items-center mb-4 text-sm font-bold border-b-2 border-black pb-4">
          <span>
            {isDisabled ? (
              <span className="text-red-600 animate-pulse">RELOAD IN: {timeUntilReset}</span>
            ) : (
              <span>VOTES_LEFT: <span className="text-green-600">{isAdmin ? '∞' : votesRemaining}/3</span></span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className={ablyConnected ? 'text-green-600' : 'text-red-500 blink'}>{ablyConnected ? '● LIVE' : '○ OFFLINE'}</span>
            <button
              onClick={async () => {
                if (isRefreshing) return;
                
                // Check cooldown
                const now = Date.now();
                if (now < cooldownUntil) {
                  const remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
                  setErrorMessage(`REFRESH COOLDOWN: ${remainingSeconds}s`);
                  setTimeout(() => setErrorMessage(null), 2000);
                  return;
                }
                
                // Track clicks for spam detection
                const timeSinceLastClick = now - lastRefreshTime;
                if (timeSinceLastClick < 2000) { // Within 2 seconds
                  const newCount = refreshClickCount + 1;
                  setRefreshClickCount(newCount);
                  
                  if (newCount >= 3) {
                    // Activate cooldown
                    setCooldownUntil(now + 5000); // 5 second cooldown
                    setErrorMessage('REFRESH COOLDOWN: 5s');
                    setTimeout(() => setErrorMessage(null), 2000);
                    return;
                  }
                } else {
                  // Reset counter if enough time has passed
                  setRefreshClickCount(1);
                }
                
                setLastRefreshTime(now);
                setIsRefreshing(true);
                try {
                  await fetchCounters();
                  // Refresh stats
                  try {
                    const response = await fetch('/api/stats');
                    if (response.ok) {
                      const data = await response.json();
                      setStats(data);
                    }
                  } catch (error) {
                    // Silently fail
                  }
                  // Refresh last vote
                  try {
                    const response = await fetch('/api/last-vote');
                    if (response.ok) {
                      const data = await response.json();
                      setLastGlobalVote(data.lastVote);
                    }
                  } catch (error) {
                    // Silently fail
                  }
                  // Refresh admin stats if admin
                  if (isAdmin) {
                    try {
                      const response = await fetch('/api/admin/stats');
                      if (response.ok) {
                        const data = await response.json();
                        setAdminStats(prev => ({
                          ...prev,
                          ...data,
                          onlineCount: prev.onlineCount,
                          onlineTeamA: prev.onlineTeamA,
                          onlineTeamB: prev.onlineTeamB,
                        }));
                      }
                    } catch (error) {
                      // Silently fail
                    }
                  }
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing || Date.now() < cooldownUntil}
              className="border-2 border-black px-3 py-1 text-xs font-bold bg-white hover:bg-black hover:text-white active:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
              title="Refresh data"
            >
              {isRefreshing ? (
                <>
                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>REFRESHING...</span>
                </>
              ) : cooldownDisplay > 0 ? (
                <>
                  <span className="text-red-600">⏱</span>
                  <span>COOLDOWN: {cooldownDisplay}s</span>
                </>
              ) : (
                <>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>REFRESH</span>
                </>
              )}
            </button>
          </div>
      </div>

        {/* Counters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((id) => (
            <div key={id} className="bg-white border-2 border-black p-3 flex flex-col items-center shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
              <span className="text-xs font-bold text-gray-400 mb-2">CNTR_0{id}</span>
              <div className="w-full bg-gray-50 border-2 border-black py-4 mb-3 flex justify-center shadow-inner">
                <span className="text-3xl font-bold">{counters[id - 1]}</span>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {/* Admin View */}
                {isAdmin ? (
                  <div className="flex gap-2 w-full">
                    <button 
                      onClick={() => handleClick(id as 1|2|3, -1)} 
                      disabled={isSubmitting}
                      className="flex-1 bg-red-600 text-white border-2 border-black hover:bg-red-700 active:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold transition-colors py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                    >
                      [-] DOWN
                    </button>
                    <button 
                      onClick={() => handleClick(id as 1|2|3, 1)} 
                      disabled={isSubmitting}
                      className="flex-1 bg-blue-600 text-white border-2 border-black hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold transition-colors py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                    >
                      [+] UP
                    </button>
            </div>
                ) : (
                  <>
                    {/* Team A View */}
                    {isTeamA && (
                      <>
                        <button
                          onClick={() => handleClick(id as 1|2|3, 1)}
                          disabled={isDisabled}
                          className="w-full bg-blue-600 text-white border-2 border-black hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:bg-gray-400 disabled:cursor-not-allowed py-3 text-sm font-bold transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                        >
                          [+] VOTE UP
                        </button>
                        <button
                          onClick={() => handleClick(id as 1|2|3, -1)}
                          disabled={isDisabled}
                          className="w-full bg-red-100 border-2 border-black hover:bg-red-200 active:bg-red-300 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed py-1 text-[10px] font-bold text-red-900 transition-colors uppercase tracking-wider shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                        >
                          [-] VOTE DOWN (TRAITOR)
                        </button>
                      </>
                    )}

                    {/* Team B View */}
                    {isTeamB && (
                      <>
              <button
                          onClick={() => handleClick(id as 1|2|3, -1)}
                disabled={isDisabled}
                          className="w-full bg-red-600 text-white border-2 border-black hover:bg-red-700 active:bg-red-800 disabled:opacity-50 disabled:bg-gray-400 disabled:cursor-not-allowed py-3 text-sm font-bold transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                        >
                          [-] VOTE DOWN
              </button>
              <button
                          onClick={() => handleClick(id as 1|2|3, 1)}
                disabled={isDisabled}
                          className="w-full bg-blue-100 border-2 border-black hover:bg-blue-200 active:bg-blue-300 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed py-1 text-[10px] font-bold text-blue-900 transition-colors uppercase tracking-wider shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                        >
                          [+] VOTE UP (TRAITOR)
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Admin Statistics Panel */}
        {isAdmin && (
          <div className="border-2 border-black p-3 bg-yellow-50 mb-4 text-xs font-mono border-dashed">
            <div className="border-b border-black/10 mb-2 pb-1 text-yellow-700 font-bold">:: ADMIN STATISTICS ::</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="text-center">
                <div className="text-gray-500 text-[10px] uppercase mb-1">ONLINE NOW</div>
                <div className="text-lg font-black">{adminStats.onlineCount}</div>
              </div>
              <div className="text-center">
                <div className="text-blue-600 text-[10px] uppercase mb-1">ONLINE TEAM A</div>
                <div className="text-lg font-black text-blue-600">{adminStats.onlineTeamA}</div>
              </div>
              <div className="text-center">
                <div className="text-red-600 text-[10px] uppercase mb-1">ONLINE TEAM B</div>
                <div className="text-lg font-black text-red-600">{adminStats.onlineTeamB}</div>
              </div>
              <div className="text-center">
                <div className="text-gray-500 text-[10px] uppercase mb-1">VOTE RATE/MIN</div>
                <div className="text-lg font-black">{adminStats.voteRate.toFixed(1)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center">
                <div className="text-blue-600 text-[10px] uppercase mb-1">VOTES TODAY (A)</div>
                <div className="text-lg font-black text-blue-600">{adminStats.votesTodayTeamA}</div>
              </div>
              <div className="text-center">
                <div className="text-red-600 text-[10px] uppercase mb-1">VOTES TODAY (B)</div>
                <div className="text-lg font-black text-red-600">{adminStats.votesTodayTeamB}</div>
              </div>
              <div className="text-center">
                <div className="text-blue-600 text-[10px] uppercase mb-1">VOTES ALL TIME (A)</div>
                <div className="text-lg font-black text-blue-600">{adminStats.votesAllTimeTeamA}</div>
              </div>
              <div className="text-center">
                <div className="text-red-600 text-[10px] uppercase mb-1">VOTES ALL TIME (B)</div>
                <div className="text-lg font-black text-red-600">{adminStats.votesAllTimeTeamB}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabbed Session Log */}
        <div className="border-2 border-black bg-white font-mono">
          {/* Tabs */}
          <div className="flex border-b-2 border-black">
            <button
              onClick={() => {
                setActiveLogTab('local');
                track('log_tab_switch', { tab: 'local' });
              }}
              className={`flex-1 px-3 py-2 text-xs font-bold border-r-2 border-black transition-colors ${
                activeLogTab === 'local'
                  ? 'bg-black text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              LOCAL
            </button>
            <button
              onClick={() => {
                setActiveLogTab('global');
                track('log_tab_switch', { tab: 'global' });
              }}
              className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${
                activeLogTab === 'global'
                  ? 'bg-black text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              GLOBAL
            </button>
          </div>
          
          {/* Tab Content */}
          <div className="p-2 text-xs h-32 overflow-y-auto">
            {activeLogTab === 'local' ? (
              <>
                <div className="border-b border-black/10 mb-2 pb-1 text-gray-400 font-bold text-[10px]">:: LOCAL_SESSION_LOG ::</div>
                {voteHistory.length === 0 ? (
                  <div className="text-gray-400 italic text-center mt-8">NO_ACTIVITY_YET...</div>
                ) : (
                  <ul className="space-y-1">
                    {voteHistory.map((log) => (
                      <li key={log.id} className="flex justify-between border-b border-gray-100 pb-1">
                        <span>&gt; VOTED {log.delta > 0 ? '+' : ''}{log.delta} ON CNTR_0{log.counterId}</span>
                        <span className="text-gray-400">{log.timestamp}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="border-b border-black/10 mb-2 pb-1 text-gray-400 font-bold text-[10px]">:: GLOBAL_SESSION_LOG ::</div>
                {lastGlobalVote ? (
                  <div className="flex justify-between items-center border-b border-gray-100 pb-1">
                    <span>
                      &gt; <span className={`font-bold ${lastGlobalVote.team === 'A' ? 'text-blue-600' : 'text-red-600'}`}>TEAM {lastGlobalVote.team}</span> VOTED {lastGlobalVote.delta > 0 ? '+' : ''}{lastGlobalVote.delta} ON CNTR_0{lastGlobalVote.counterId}
                    </span>
                    <span className="text-gray-400">
                      {new Date(lastGlobalVote.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ) : (
                  <div className="text-gray-400 italic text-center mt-8">NO_GLOBAL_ACTIVITY_YET...</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Statistics */}
        <div className="border-2 border-black p-3 bg-gray-50 mb-4 text-xs font-mono">
          <div className="border-b border-black/10 mb-2 pb-1 text-gray-400 font-bold">:: STATISTICS ::</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="text-center">
              <div className="text-gray-500 text-[10px] uppercase mb-1">TOTAL VOTES</div>
              <div className="text-lg font-black">{stats.totalVotes}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-[10px] uppercase mb-1">TOTAL USERS</div>
              <div className="text-lg font-black">{stats.totalUsers}</div>
            </div>
            <div className="text-center">
              <div className="text-green-600 text-[10px] uppercase mb-1">ONLINE NOW</div>
              <div className="text-lg font-black text-green-600">{onlineCount}</div>
            </div>
            <div className="text-center">
              <div className="text-blue-600 text-[10px] uppercase mb-1">TEAM A USERS</div>
              <div className="text-lg font-black text-blue-600">{stats.teamAUsers}</div>
            </div>
            <div className="text-center">
              <div className="text-red-600 text-[10px] uppercase mb-1">TEAM B USERS</div>
              <div className="text-lg font-black text-red-600">{stats.teamBUsers}</div>
            </div>
          </div>
        </div>

        {/* Admin Footer */}
        <div className="mt-4 flex justify-end">
          {!isAdmin ? (
            <>
              <button onClick={() => setShowAdminLogin(!showAdminLogin)} className="text-[10px] text-gray-300 hover:text-gray-500 uppercase">
                admin_login
              </button>
              {showAdminLogin && (
                <div className="absolute bottom-20 right-4 bg-white border-2 border-black p-2 shadow-lg z-20 flex gap-2">
                  <input
                    type="password"
                    className="border-2 border-black px-2 py-1 w-24 text-xs"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                  />
                  <button onClick={handleAdminLogin} className="bg-black text-white px-2 py-1 text-xs hover:bg-gray-700">OK</button>
                </div>
              )}
            </>
          ) : (
            <div className="flex gap-2 text-xs">
              <button onClick={() => handleReset('counters')} className="text-red-500 hover:underline">[RST_CNTRS]</button>
              <button onClick={() => handleReset('votes')} className="text-orange-600 hover:underline">[RST_VOTES]</button>
              <button onClick={() => handleReset('all')} className="text-red-600 font-bold hover:underline">[HARD_RESET]</button>
              <button 
                onClick={() => {
                  setShowWinnerTest(true);
                  track('admin_test_winner', { action: 'open' });
                }} 
                className="text-purple-600 hover:underline"
              >
                [TEST WINNER]
              </button>
              <button onClick={handleAdminLogout} className="text-gray-600 hover:underline">[LOGOUT]</button>
            </div>
          )}
      </div>

      </div>
    </div>
  );
}
