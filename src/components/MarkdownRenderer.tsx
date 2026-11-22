import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div
      dir="rtl"
      className={`prose prose-sm sm:prose-base dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-6 mb-3 pb-2 border-b border-slate-200 dark:border-slate-800">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg sm:text-xl font-bold text-indigo-700 dark:text-indigo-300 mt-5 mb-2.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mt-4 mb-2">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-3.5 leading-7 text-slate-700 dark:text-slate-200">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1.5 mb-4 pr-2 text-slate-700 dark:text-slate-200">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1.5 mb-4 pr-2 text-slate-700 dark:text-slate-200">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-7">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm text-right border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 font-semibold border-b border-slate-200 dark:border-slate-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 border-b border-slate-200/70 dark:border-slate-800/80">
              {children}
            </td>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = Boolean(codeClass && codeClass.includes('language-'));
            if (isBlock) {
              return (
                <pre
                  dir="ltr"
                  className="my-4 p-4 rounded-xl bg-slate-900 text-slate-100 border border-slate-800 overflow-x-auto text-xs sm:text-sm font-mono leading-relaxed"
                >
                  <code className={codeClass} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code
                dir="ltr"
                className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-mono text-xs sm:text-sm"
                {...props}
              >
                {children}
              </code>
            );
          },
          strong: ({ children }) => (
            <strong className="font-bold text-slate-900 dark:text-white">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
