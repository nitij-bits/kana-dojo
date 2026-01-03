'use client';
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { kana } from '@/features/Kana/data/kana';
import useKanaStore from '@/features/Kana/store/useKanaStore';
import { CircleCheck, CircleX, CircleArrowRight } from 'lucide-react';
import { Random } from 'random-js';
import { useCorrect, useError, useClick } from '@/shared/hooks/useAudio';
import GameIntel from '@/shared/components/Game/GameIntel';
import { getGlobalAdaptiveSelector } from '@/shared/lib/adaptiveSelection';
import Stars from '@/shared/components/Game/Stars';
import { useCrazyModeTrigger } from '@/features/CrazyMode/hooks/useCrazyModeTrigger';
import useStatsStore from '@/features/Progress/store/useStatsStore';
import { useShallow } from 'zustand/react/shallow';
import useStats from '@/shared/hooks/useStats';
import { ActionButton } from '@/shared/components/ui/ActionButton';

const random = new Random();
const adaptiveSelector = getGlobalAdaptiveSelector();

// Duolingo-like spring animation config
const springConfig = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8
};

// Helper function to determine if a kana character is hiragana or katakana
const isHiragana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
};

const isKatakana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x30a0 && code <= 0x30ff;
};

interface TileProps {
  id: string;
  char: string;
  onClick: () => void;
  isDisabled?: boolean;
  isBlank?: boolean;
}

// Memoized tile component for smooth animations
const Tile = memo(({ id, char, onClick, isDisabled, isBlank }: TileProps) => {
  // Blank placeholder tile (invisible but takes space)
  if (isBlank) {
    return (
      <motion.div
        layoutId={`blank-${id}`}
        className={clsx(
          'relative flex items-center justify-center rounded-xl px-3 py-1.5 text-2xl font-medium sm:px-4 sm:py-2 sm:text-3xl',
          'border-b-4 border-transparent bg-[var(--border-color)]/30',
          'select-none'
        )}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <span className='opacity-0'>{char}</span>
      </motion.div>
    );
  }

  return (
    <motion.button
      layoutId={id}
      type='button'
      onClick={onClick}
      disabled={isDisabled}
      className={clsx(
        'relative flex cursor-pointer items-center justify-center rounded-xl px-3 py-1.5 text-2xl font-medium transition-colors sm:px-4 sm:py-2 sm:text-3xl',
        'border-b-4 active:translate-y-[4px] active:border-b-0',
        'border-[var(--secondary-color-accent)] bg-[var(--secondary-color)] text-[var(--background-color)]',
        isDisabled && 'cursor-not-allowed opacity-50'
      )}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={springConfig}
    >
      {char}
    </motion.button>
  );
});

Tile.displayName = 'Tile';

// Bottom bar states
type BottomBarState = 'check' | 'correct' | 'wrong';

interface WordBuildingGameProps {
  isHidden: boolean;
  isReverse: boolean;
  wordLength: number;
  onCorrect: (chars: string[]) => void;
  onWrong: () => void;
}

const WordBuildingGame = ({
  isHidden,
  isReverse,
  wordLength,
  onCorrect,
  onWrong
}: WordBuildingGameProps) => {
  const { playCorrect } = useCorrect();
  const { playErrorTwice } = useError();
  const { playClick } = useClick();
  const { trigger: triggerCrazyMode } = useCrazyModeTrigger();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const {
    score,
    setScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementWrongStreak,
    resetWrongStreak
  } = useStatsStore(
    useShallow(state => ({
      score: state.score,
      setScore: state.setScore,
      incrementHiraganaCorrect: state.incrementHiraganaCorrect,
      incrementKatakanaCorrect: state.incrementKatakanaCorrect,
      incrementWrongStreak: state.incrementWrongStreak,
      resetWrongStreak: state.resetWrongStreak
    }))
  );

  const {
    incrementCorrectAnswers,
    incrementWrongAnswers,
    addCharacterToHistory,
    incrementCharacterScore
  } = useStats();

  const kanaGroupIndices = useKanaStore(state => state.kanaGroupIndices);

  // Get all available kana and romaji from selected groups
  const { selectedKana, selectedRomaji, kanaToRomaji, romajiToKana } =
    useMemo(() => {
      const kanaChars = kanaGroupIndices.map(i => kana[i].kana).flat();
      const romajiChars = kanaGroupIndices.map(i => kana[i].romanji).flat();

      const k2r: Record<string, string> = {};
      const r2k: Record<string, string> = {};

      kanaChars.forEach((k, i) => {
        k2r[k] = romajiChars[i];
        r2k[romajiChars[i]] = k;
      });

      return {
        selectedKana: kanaChars,
        selectedRomaji: romajiChars,
        kanaToRomaji: k2r,
        romajiToKana: r2k
      };
    }, [kanaGroupIndices]);

  const [feedback, setFeedback] = useState(<>{'Build the word!'}</>);
  const [bottomBarState, setBottomBarState] = useState<BottomBarState>('check');
  // Track tiles that are animating back (to delay blank removal)
  const [animatingTiles, setAnimatingTiles] = useState<Set<string>>(new Set());

  // Generate a word (array of characters) and distractors
  const generateWord = useCallback(() => {
    const sourceChars = isReverse ? selectedRomaji : selectedKana;
    if (sourceChars.length < wordLength) {
      return { wordChars: [], answerChars: [], allTiles: [] };
    }

    const wordChars: string[] = [];
    const usedChars = new Set<string>();

    for (let i = 0; i < wordLength; i++) {
      const available = sourceChars.filter(c => !usedChars.has(c));
      if (available.length === 0) break;

      const selected = adaptiveSelector.selectWeightedCharacter(available);
      wordChars.push(selected);
      usedChars.add(selected);
      adaptiveSelector.markCharacterSeen(selected);
    }

    const answerChars = isReverse
      ? wordChars.map(r => romajiToKana[r])
      : wordChars.map(k => kanaToRomaji[k]);

    const distractorCount = Math.min(3, sourceChars.length - wordLength);
    const distractorSource = isReverse ? selectedKana : selectedRomaji;
    const distractors: string[] = [];
    const usedAnswers = new Set(answerChars);

    for (let i = 0; i < distractorCount; i++) {
      const available = distractorSource.filter(
        c => !usedAnswers.has(c) && !distractors.includes(c)
      );
      if (available.length === 0) break;
      const selected = available[random.integer(0, available.length - 1)];
      distractors.push(selected);
    }

    const allTiles = [...answerChars, ...distractors].sort(
      () => random.real(0, 1) - 0.5
    );

    return { wordChars, answerChars, allTiles };
  }, [
    isReverse,
    selectedKana,
    selectedRomaji,
    wordLength,
    kanaToRomaji,
    romajiToKana
  ]);

  const [wordData, setWordData] = useState(() => generateWord());
  const [placedTiles, setPlacedTiles] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const resetGame = useCallback(() => {
    const newWord = generateWord();
    setWordData(newWord);
    setPlacedTiles([]);
    setIsChecking(false);
    setBottomBarState('check');
    setAnimatingTiles(new Set());
    setFeedback(<>{'Build the word!'}</>);
  }, [generateWord]);

  useEffect(() => {
    resetGame();
  }, [isReverse, wordLength, resetGame]);

  // Keyboard shortcut for Enter/Space to trigger button
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'Enter') ||
        event.code === 'Space' ||
        event.key === ' '
      ) {
        buttonRef.current?.click();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle Check button - validates the answer (user can check anytime with any number of tiles)
  const handleCheck = useCallback(() => {
    if (placedTiles.length === 0) return;

    playClick();
    setIsChecking(true);

    const isCorrect =
      placedTiles.length === wordData.answerChars.length &&
      placedTiles.every((tile, i) => tile === wordData.answerChars[i]);

    if (isCorrect) {
      playCorrect();
      triggerCrazyMode();
      resetWrongStreak();

      wordData.wordChars.forEach(char => {
        addCharacterToHistory(char);
        incrementCharacterScore(char, 'correct');
        adaptiveSelector.updateCharacterWeight(char, true);

        if (isHiragana(char)) {
          incrementHiraganaCorrect();
        } else if (isKatakana(char)) {
          incrementKatakanaCorrect();
        }
      });

      incrementCorrectAnswers();
      setScore(score + wordData.wordChars.length);
      setBottomBarState('correct');

      setFeedback(
        <>
          <span>
            {wordData.wordChars.join('')} = {wordData.answerChars.join('')}
          </span>
          <CircleCheck className='ml-2 inline text-[var(--main-color)]' />
        </>
      );
    } else {
      playErrorTwice();
      triggerCrazyMode();
      incrementWrongStreak();
      incrementWrongAnswers();

      wordData.wordChars.forEach(char => {
        incrementCharacterScore(char, 'wrong');
        adaptiveSelector.updateCharacterWeight(char, false);
      });

      if (score - 1 >= 0) {
        setScore(score - 1);
      }

      setBottomBarState('wrong');

      setFeedback(
        <>
          <span>Wrong! Correct: {wordData.answerChars.join('')}</span>
          <CircleX className='ml-2 inline text-[var(--main-color)]' />
        </>
      );

      onWrong();
    }
  }, [
    placedTiles,
    wordData,
    playClick,
    playCorrect,
    playErrorTwice,
    triggerCrazyMode,
    resetWrongStreak,
    incrementWrongStreak,
    addCharacterToHistory,
    incrementCharacterScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementCorrectAnswers,
    incrementWrongAnswers,
    score,
    setScore,
    onWrong
  ]);

  // Handle Continue button - goes to next word
  const handleContinue = useCallback(() => {
    playClick();
    if (bottomBarState === 'correct') {
      onCorrect(wordData.wordChars);
    }
    resetGame();
  }, [playClick, bottomBarState, onCorrect, wordData.wordChars, resetGame]);

  // Handle tile click - add or remove
  const handleTileClick = useCallback(
    (char: string) => {
      if (isChecking) return;

      if (placedTiles.includes(char)) {
        // Remove from placed tiles - mark as animating first
        setAnimatingTiles(prev => new Set(prev).add(char));
        setPlacedTiles(prev => prev.filter(c => c !== char));

        // Remove from animating after animation completes
        setTimeout(() => {
          setAnimatingTiles(prev => {
            const next = new Set(prev);
            next.delete(char);
            return next;
          });
        }, 300);
      } else {
        // Add to placed tiles
        setPlacedTiles(prev => [...prev, char]);
      }
    },
    [isChecking, placedTiles]
  );

  // Not enough characters for word building
  if (selectedKana.length < wordLength || wordData.wordChars.length === 0) {
    return null;
  }

  const canCheck = placedTiles.length > 0 && !isChecking;
  const showContinue =
    bottomBarState === 'correct' || bottomBarState === 'wrong';

  return (
    <div
      className={clsx(
        'flex w-full flex-col items-center gap-6 sm:w-4/5 sm:gap-10',
        isHidden && 'hidden'
      )}
    >
      <GameIntel gameMode='word-building' feedback={feedback} />

      {/* Word Display - matches normal Pick game styling */}
      <div className='flex flex-row items-center gap-1'>
        <motion.p
          className='text-8xl font-medium sm:text-9xl'
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          key={wordData.wordChars.join('')}
        >
          {wordData.wordChars.join('')}
        </motion.p>
      </div>

      {/* Answer Row Area - bottom border only, reduced padding */}
      <div className='flex w-full flex-col items-center'>
        <div className='flex min-h-[4.5rem] w-full items-center border-b border-[var(--border-color)] px-2 sm:w-1/2'>
          <div className='flex flex-row flex-wrap justify-start gap-3'>
            <AnimatePresence mode='sync'>
              {placedTiles.map((char, index) => (
                <Tile
                  key={`placed-${index}-${char}`}
                  id={`tile-${char}`}
                  char={char}
                  onClick={() => handleTileClick(char)}
                  isDisabled={isChecking}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Available Tiles - blank placeholders stay until animation completes */}
      <div className='flex flex-row flex-wrap justify-center gap-3 sm:gap-4'>
        <AnimatePresence mode='sync'>
          {wordData.allTiles.map((char, index) => {
            const isPlaced = placedTiles.includes(char);
            const isAnimatingBack = animatingTiles.has(char);
            // Show blank if placed OR if animating back
            const showBlank = isPlaced || isAnimatingBack;

            return (
              <Tile
                key={`option-${char}-${index}`}
                id={`tile-${char}`}
                char={char}
                onClick={() => handleTileClick(char)}
                isDisabled={isChecking}
                isBlank={showBlank}
              />
            );
          })}
        </AnimatePresence>
      </div>

      <Stars />

      {/* Bottom Bar - positioned above the main BottomBar like AnswerSummary */}
      <div
        className={clsx(
          'w-[100vw]',
          'border-t-2 border-[var(--border-color)] bg-[var(--card-color)]',
          'absolute bottom-0 z-10 px-4 py-4 md:bottom-6',
          'flex flex-col items-center justify-center gap-3'
        )}
      >
        {/* Feedback message for correct/wrong - Duolingo style */}
        {showContinue && (
          <div className='flex w-full items-center gap-3 md:w-1/2'>
            {bottomBarState === 'correct' ? (
              <CircleCheck className='h-10 w-10 text-[var(--main-color)]' />
            ) : (
              <CircleX className='h-10 w-10 text-[var(--secondary-color)]' />
            )}
            <div className='flex flex-col'>
              <span
                className={clsx(
                  'text-lg font-bold',
                  bottomBarState === 'correct'
                    ? 'text-[var(--main-color)]'
                    : 'text-[var(--secondary-color)]'
                )}
              >
                {bottomBarState === 'correct'
                  ? 'Nicely done!'
                  : 'Correct solution:'}
              </span>
              <span className='text-sm text-[var(--text-secondary-color)]'>
                {wordData.answerChars.join('')}
              </span>
            </div>
          </div>
        )}

        <ActionButton
          ref={buttonRef}
          borderBottomThickness={8}
          borderRadius='3xl'
          className='w-full py-4 text-xl md:w-1/2'
          onClick={showContinue ? handleContinue : handleCheck}
          disabled={!canCheck && !showContinue}
        >
          <span>{showContinue ? 'continue' : 'check'}</span>
          <CircleArrowRight />
        </ActionButton>
      </div>

      {/* Spacer to prevent content being hidden behind fixed bottom bar */}
      <div className='h-40' />
    </div>
  );
};

export default WordBuildingGame;
