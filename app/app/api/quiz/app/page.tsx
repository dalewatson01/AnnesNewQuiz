'use client';

import { useState, useEffect } from 'react';

interface Question {
  id: number;
  category: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

interface QuizData {
  title: string;
  date: string;
  questions: Question[];
}

export default function Home() {
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: string }>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    fetch('/api/quiz')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.questions) {
          setQuiz(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load quiz', err);
        setLoading(false);
      });
  }, []);

  const handleSelectOption = (questionId: number, option: string) => {
    if (submitted) return;
    setSelectedAnswers({ ...selectedAnswers, [questionId]: option });
  };

  const handleSubmit = () => {
    if (!quiz) return;
    let correctCount = 0;
    quiz.questions.forEach((q) => {
      if (selectedAnswers[q.id] === q.answer) {
        correctCount++;
      }
    });
    setScore(correctCount);
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-serif font-bold tracking-wide border-b-2 border-black pb-4 mb-6">
          The Daily Broadsheet
        </h1>
        <p className="text-lg italic text-zinc-600 animate-pulse">
          Compiling today&apos;s edition and generating quiz...
        </p>
      </main>
    );
  }

  if (!quiz || !quiz.questions) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-serif font-bold tracking-wide border-b-2 border-black pb-4 mb-6">
          The Daily Broadsheet
        </h1>
        <p className="text-red-700 font-medium">
          Unable to load today&apos;s quiz. Please refresh the page.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Broadsheet Header */}
      <header className="text-center border-b-4 border-black pb-6 mb-8">
        <div className="flex justify-between items-center text-xs uppercase tracking-widest border-b border-black pb-2 mb-4 font-sans font-semibold">
          <span>Vol. I No. {new Date().getDate()}</span>
          <span>{quiz.date || new Date().toDateString()}</span>
          <span>Price: Complimentary</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-serif font-extrabold tracking-tight uppercase">
          {quiz.title}
        </h1>
        <p className="text-sm italic text-zinc-700 mt-2">
          An AI-powered intellectual morning briefing covering history, science, literature, and culture.
        </p>
      </header>

      {submitted && (
        <div className="bg-amber-100 border-2 border-black p-6 mb-8 text-center">
          <h2 className="text-2xl font-bold font-serif mb-2">Final Evaluation</h2>
          <p className="text-lg">
            You scored <span className="font-bold">{score}</span> out of {quiz.questions.length}.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-black text-white text-sm uppercase tracking-wider font-sans hover:bg-zinc-800 transition"
          >
            Generate New Edition
          </button>
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-8">
        {quiz.questions.map((q, index) => {
          const userChoice = selectedAnswers[q.id];
          const isCorrect = userChoice === q.answer;

          return (
            <article key={q.id} className="border-b border-zinc-400 pb-6">
              <div className="flex justify-between items-center text-xs font-sans uppercase tracking-wider text-zinc-600 mb-1">
                <span>Article {index + 1}</span>
                <span className="bg-zinc-200 px-2 py-0.5 text-black font-semibold">{q.category}</span>
              </div>
              <h3 className="text-lg font-bold font-serif mb-3 text-zinc-900">
                {q.question}
              </h3>
              <div className="space-y-2 mb-3">
                {q.options.map((option, optIdx) => {
                  let btnStyle = 'w-full text-left px-4 py-2 border border-zinc-400 bg-white hover:bg-zinc-100 text-sm font-sans transition';
                  if (userChoice === option) {
                    btnStyle = 'w-full text-left px-4 py-2 border-2 border-black bg-zinc-200 text-sm font-sans font-semibold';
                  }
                  if (submitted) {
                    if (option === q.answer) {
                      btnStyle = 'w-full text-left px-4 py-2 border-2 border-green-700 bg-green-50 text-sm font-sans font-semibold text-green-900';
                    } else if (userChoice === option && option !== q.answer) {
                      btnStyle = 'w-full text-left px-4 py-2 border-2 border-red-700 bg-red-50 text-sm font-sans font-semibold text-red-900';
                    }
                  }

                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleSelectOption(q.id, option)}
                      className={btnStyle}
                      disabled={submitted}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              {submitted && (
                <div className="text-xs font-sans text-zinc-700 bg-zinc-100 p-3 border-l-2 border-black mt-2">
                  <span className="font-bold">Dispatch Note:</span> {q.explanation}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {!submitted && (
        <div className="mt-10 text-center pb-12">
          <button
            onClick={handleSubmit}
            className="px-8 py-3 bg-black text-white uppercase font-sans tracking-widest text-sm hover:bg-zinc-800 shadow transition"
          >
            Submit For Evaluation
          </button>
        </div>
      )}
    </main>
  );
}
