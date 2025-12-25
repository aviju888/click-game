'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Ably from 'ably';

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
  
  // Random Vote State
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [pendingRandomVotes, setPendingRandomVotes] = useState<PendingVote[]>([]);
  
  // Loading State
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Admin State
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

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
      const response = await fetch('/api/counters');
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

        ablyClient.connection.on('connected', () => setAblyConnected(true));
        ablyClient.connection.on('disconnected', () => setAblyConnected(false));

        channel = ablyClient.channels.get('global-counter');
        channel.subscribe('update', (message: any) => {
          const data = message.data;
          if (data) {
            setCounters(data.counters);
            setTeamScore(data.teamScore);
          }
        });
      } catch (error) {
        console.error('Error initializing Ably:', error);
        setAblyConnected(false);
      }
    };

    initAbly();
    fetchCounters();
    checkAdminStatus();

    return () => {
      channel?.unsubscribe();
      ablyClient?.close();
    };
  }, [fetchCounters, checkAdminStatus]);

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
      } else {
        setErrorMessage('LOGOUT FAILED');
      }
    } catch {
      setErrorMessage('SYSTEM ERROR');
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
        fetchCounters();
      } else {
        setErrorMessage('RESET FAILED');
      }
    } catch {
      setErrorMessage('RESET FAILED');
    }
  };

  const handleClick = async (counterId: 1 | 2 | 3, delta: 1 | -1) => {
    if (isSubmitting) return; // Prevent rapid clicks
    
    if (!isAdmin && votesRemaining <= 0) {
      setErrorMessage(`WAIT: ${timeUntilReset}`);
      return;
    }

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

  return (
    <div className="min-h-screen w-full bg-[#c0c0c0] flex flex-col items-center py-8 px-4 font-mono text-black border-8 border-gray-400 relative">
      
      {/* Toast */}
      {(errorMessage || successMessage) && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${errorMessage ? 'bg-red-500 text-white' : 'bg-green-500 text-black'}`}>
          <span className="font-bold uppercase">{errorMessage || successMessage}</span>
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
              onClick={() => setShowHelp(!showHelp)}
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
            <p className="text-xs text-gray-500 border-t border-black/20 pt-2 italic">
              "i made this game for fun - adriel v."
            </p>
          </div>
        )}

        {/* Minimal Scoreboard */}
        <div className="bg-gray-100 border-2 border-black p-4 mb-8 text-center relative">
          {/* The Bar */}
          <div className="h-6 w-full bg-gray-300 border-2 border-black relative mb-4 flex items-center overflow-hidden">
            {/* Center Line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-black/20 z-0"></div>
            
            {/* Moving Indicator */}
            <div 
              className="absolute top-0 bottom-0 w-2 bg-black border-x border-white z-10 transition-all duration-500 ease-out"
              style={{ left: `${indicatorPosition}%` }}
            ></div>

            {/* Fill Color */}
            <div 
              className={`absolute top-0 bottom-0 transition-all duration-500 ease-out ${teamScore > 0 ? 'bg-blue-200 left-1/2' : 'bg-red-200 right-1/2'}`}
              style={{ width: `${Math.min(Math.abs(rawPercentage - 50), 50)}%` }}
            ></div>
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
            <span className="font-black uppercase tracking-widest text-xl">
              YOU ARE TEAM {userTeam || '?'}
            </span>
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
          <span className={ablyConnected ? 'text-green-600' : 'text-red-500 blink'}>{ablyConnected ? '● LIVE' : '○ OFFLINE'}</span>
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

        {/* Local Session Log */}
        <div className="border-2 border-black p-2 bg-white text-xs h-32 overflow-y-auto font-mono">
          <div className="border-b border-black/10 mb-2 pb-1 text-gray-400 font-bold">:: LOCAL_SESSION_LOG ::</div>
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
              <button onClick={() => handleReset('all')} className="text-red-600 font-bold hover:underline">[HARD_RESET]</button>
              <button onClick={handleAdminLogout} className="text-gray-600 hover:underline">[LOGOUT]</button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
