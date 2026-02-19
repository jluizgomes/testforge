import { useState, useRef, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Send,
  Bot,
  User,
  Sparkles,
  Code,
  Bug,
  FileText,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api-client'
import { useAppStore } from '@/stores/app-store'

// ── Markdown-lite renderer ──────────────────────────────────────────────────

/** Split message content into text and fenced code blocks. */
function parseMessageBlocks(content: string): Array<{ type: 'text' | 'code'; lang?: string; value: string }> {
  const blocks: Array<{ type: 'text' | 'code'; lang?: string; value: string }> = []
  const fenceRe = /^```(\w*)\n?([\s\S]*?)^```/gm
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fenceRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    blocks.push({ type: 'code', lang: match[1] || undefined, value: match[2].replace(/\n$/, '') })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    blocks.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return blocks.length ? blocks : [{ type: 'text', value: content }]
}

function CodeBlock({ lang, value }: { lang?: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-2 rounded-md bg-zinc-950 border border-zinc-800">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
        <span className="text-[10px] font-medium text-zinc-500 uppercase">{lang || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs text-zinc-300 leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  )
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser) {
    return <p className="whitespace-pre-wrap text-sm">{content}</p>
  }

  const blocks = parseMessageBlocks(content)
  return (
    <div className="text-sm space-y-1">
      {blocks.map((block, i) =>
        block.type === 'code' ? (
          <CodeBlock key={i} lang={block.lang} value={block.value} />
        ) : (
          <p key={i} className="whitespace-pre-wrap">{block.value}</p>
        )
      )}
    </div>
  )
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const suggestedPrompts = [
  {
    icon: Code,
    title: 'Generate Tests',
    prompt: 'Generate E2E tests for the login page using Playwright',
  },
  {
    icon: Bug,
    title: 'Analyze Failure',
    prompt: 'Why do E2E tests fail when elements load asynchronously?',
  },
  {
    icon: FileText,
    title: 'Improve Coverage',
    prompt: 'What test scenarios should I add to improve coverage?',
  },
]

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hello! I'm your AI testing assistant. I can help you generate tests, analyze failures, and improve your test coverage. What would you like to work on today?",
  timestamp: new Date(),
}

export function AIAssistantPage() {
  const currentProject = useAppStore(s => s.currentProject)
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    const currentInput = input
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      // Build conversation history (skip the welcome message)
      const history = messages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await apiClient.chat(
        currentProject?.id ?? 'general',
        currentInput,
        history
      )

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.response,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to reach AI assistant'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handlePromptClick = async (prompt: string) => {
    if (isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)
    setError(null)

    try {
      const history = messages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await apiClient.chat(
        currentProject?.id ?? 'general',
        prompt,
        history
      )

      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: res.response,
          timestamp: new Date(),
        },
      ])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to reach AI assistant'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Assistant</h1>
        <p className="text-muted-foreground">
          Get help with test generation, failure analysis, and more
        </p>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-4">
        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
              <CardDescription>Common tasks to get started</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {suggestedPrompts.map((item, i) => (
                <Button
                  key={i}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handlePromptClick(item.prompt)}
                  disabled={isLoading}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.title}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Context</CardTitle>
              <CardDescription>Current project context</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project:</span>
                  {currentProject ? (
                    <Badge variant="secondary" className="max-w-[120px] truncate text-xs">
                      {currentProject.name}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      None selected
                    </span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI:</span>
                  <span className="text-xs text-green-500">Ready</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RAG:</span>
                  <span className="text-xs text-muted-foreground">
                    {currentProject ? 'project context' : 'general'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chat Area */}
        <Card className="flex flex-col lg:col-span-3">
          <CardContent className="flex flex-1 flex-col p-0">
            {/* Messages */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex gap-3',
                      message.role === 'user' && 'flex-row-reverse'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        message.role === 'assistant'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        'max-w-[80%] rounded-lg px-4 py-2',
                        message.role === 'assistant'
                          ? 'bg-muted'
                          : 'bg-primary text-primary-foreground'
                      )}
                    >
                      <MessageContent content={message.content} isUser={message.role === 'user'} />
                      <span className="mt-1 block text-xs opacity-50">
                        {message.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Thinking…</span>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t p-4">
              <form
                onSubmit={e => {
                  e.preventDefault()
                  handleSend()
                }}
                className="flex gap-2"
              >
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask me anything about your tests…"
                  disabled={isLoading}
                />
                <Button type="submit" disabled={!input.trim() || isLoading}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Powered by AI with RAG context from your codebase
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
