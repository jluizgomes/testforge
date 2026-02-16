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
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
    prompt: 'Generate E2E tests for the login page',
  },
  {
    icon: Bug,
    title: 'Analyze Failure',
    prompt: 'Why did the last test run fail?',
  },
  {
    icon: FileText,
    title: 'Improve Coverage',
    prompt: 'What tests should I add to improve coverage?',
  },
]

const initialMessages: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content:
      "Hello! I'm your AI testing assistant. I can help you generate tests, analyze failures, and improve your test coverage. What would you like to work on today?",
    timestamp: new Date(),
  },
]

export function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
    setInput('')
    setIsLoading(true)

    // Simulate AI response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: generateMockResponse(input),
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])
      setIsLoading(false)
    }, 1500)
  }

  const handlePromptClick = (prompt: string) => {
    setInput(prompt)
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
                  <Badge variant="secondary">Demo Project</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tests:</span>
                  <span>156 total</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Run:</span>
                  <span>2h ago</span>
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
                      <p className="whitespace-pre-wrap text-sm">
                        {message.content}
                      </p>
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
                      <span className="text-sm">Thinking...</span>
                    </div>
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
                  placeholder="Ask me anything about your tests..."
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

function generateMockResponse(input: string): string {
  const lower = input.toLowerCase()

  if (lower.includes('generate') && lower.includes('test')) {
    return `I'll generate E2E tests for you. Based on your project structure, here's a test for the login page:

\`\`\`typescript
import { test, expect } from '@playwright/test';

test('should login successfully with valid credentials', async ({ page }) => {
  await page.goto('/login');

  await page.fill('[data-testid="email-input"]', 'user@example.com');
  await page.fill('[data-testid="password-input"]', 'password123');
  await page.click('[data-testid="login-button"]');

  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('[data-testid="welcome-message"]')).toBeVisible();
});

test('should show error for invalid credentials', async ({ page }) => {
  await page.goto('/login');

  await page.fill('[data-testid="email-input"]', 'invalid@example.com');
  await page.fill('[data-testid="password-input"]', 'wrongpassword');
  await page.click('[data-testid="login-button"]');

  await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid credentials');
});
\`\`\`

Would you like me to generate more tests or modify these?`
  }

  if (lower.includes('fail') || lower.includes('error')) {
    return `Looking at your last test run, I found a failure in the "Form Submission" test.

**Root Cause Analysis:**
- The test failed because the submit button selector \`#submit-btn\` was not found
- This could be due to a recent UI change or the element loading asynchronously

**Suggested Fixes:**
1. Update the selector to use a data-testid attribute
2. Add a wait condition before clicking the button
3. Check if the form is rendered conditionally

Here's the corrected test:

\`\`\`typescript
// Before
await page.click('#submit-btn');

// After
await page.waitForSelector('[data-testid="submit-button"]');
await page.click('[data-testid="submit-button"]');
\`\`\`

Would you like me to apply this fix?`
  }

  if (lower.includes('coverage')) {
    return `Based on analyzing your codebase, here are my recommendations to improve test coverage:

**Missing Coverage Areas:**
1. **Error handling paths** - Most error scenarios aren't tested
2. **Edge cases in forms** - Empty inputs, special characters
3. **Authentication flows** - Password reset, session expiry
4. **API error responses** - Network failures, 500 errors

**Priority Tests to Add:**
1. Test form validation for all required fields
2. Test unauthorized access redirects
3. Test loading states and skeletons
4. Test pagination in list views

Would you like me to generate tests for any of these areas?`
  }

  return `I understand you're asking about "${input}". I can help you with:

1. **Generating Tests** - Create E2E, API, or database tests
2. **Analyzing Failures** - Understand why tests failed
3. **Improving Coverage** - Identify gaps in your test suite
4. **Best Practices** - Get recommendations for better tests

What specific aspect would you like me to focus on?`
}
