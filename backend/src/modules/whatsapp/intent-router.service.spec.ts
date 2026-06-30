import { Test, TestingModule } from '@nestjs/testing';
import { IntentRouterService } from './intent-router.service';
import { MemoryService } from '../memory/memory.service';
import { ReminderService } from '../reminder/reminder.service';
import { TaskService } from '../task/task.service';
import { ContactService } from '../contact/contact.service';
import { AIService } from '../ai/ai.service';
import { ExpenseService } from '../expense/expense.service';
import { PrismaService } from '../../database/prisma.service';
import { GoogleApiService } from '../../integrations/google-api.service';

describe('IntentRouterService Clarification Dialog', () => {
  let service: IntentRouterService;
  let aiService: AIService;
  let reminderService: ReminderService;
  let expenseService: ExpenseService;
  let prisma: PrismaService;

  const mockMemoryService = {};
  const mockReminderService = {
    create: jest.fn(),
  };
  const mockTaskService = {};
  const mockContactService = {};
  const mockAIService = {
    classifyIntent: jest.fn(),
    extractClarifiedParameter: jest.fn(),
  };
  const mockExpenseService = {
    create: jest.fn(),
  };
  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    usageLog: {
      count: jest.fn(),
    },
  };
  const mockGoogleApiService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentRouterService,
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ReminderService, useValue: mockReminderService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: ContactService, useValue: mockContactService },
        { provide: AIService, useValue: mockAIService },
        { provide: ExpenseService, useValue: mockExpenseService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: GoogleApiService, useValue: mockGoogleApiService },
      ],
    }).compile();

    service = module.get<IntentRouterService>(IntentRouterService);
    aiService = module.get<AIService>(AIService);
    reminderService = module.get<ReminderService>(ReminderService);
    expenseService = module.get<ExpenseService>(ExpenseService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should trigger clarification dialog for CREATE_REMINDER if scheduledAt is missing', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-123', plan: 'pro' });
    mockAIService.classifyIntent.mockResolvedValue({
      intent: 'CREATE_REMINDER',
      confidence: 0.9,
      extracted: { title: 'jemput adek' },
    });

    const reply = await service.routeMessage('user-123', 'ingetin jemput adek');
    expect(reply).toContain('Kapan Anda ingin diingatkan untuk');
    expect(reply).toContain('jemput adek');

    // In the next turn, resolve the pending action with time input
    mockAIService.extractClarifiedParameter.mockResolvedValue({
      scheduledAt: '2026-06-30T17:00:00',
    });
    mockReminderService.create.mockResolvedValue({
      id: 'reminder-123',
      title: 'jemput adek',
      scheduledAt: new Date('2026-06-30T17:00:00'),
    });

    const secondReply = await service.routeMessage('user-123', 'besok sore jam 5');
    expect(secondReply).toContain('Pengingat Berhasil Dibuat');
    expect(mockReminderService.create).toHaveBeenCalled();
  });

  it('should trigger clarification dialog for TRACK_EXPENSE if amount is missing', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-123', plan: 'pro' });
    mockAIService.classifyIntent.mockResolvedValue({
      intent: 'TRACK_EXPENSE',
      confidence: 0.9,
      extracted: { description: 'beli kopi' },
    });

    const reply = await service.routeMessage('user-123', 'catat beli kopi');
    expect(reply).toContain('Berapa nominal pengeluaran untuk');
    expect(reply).toContain('beli kopi');

    // Resolve the pending expense with amount
    mockAIService.extractClarifiedParameter.mockResolvedValue({
      amount: 25000,
    });
    mockExpenseService.create.mockResolvedValue({
      id: 'expense-123',
      description: 'beli kopi',
      amount: 25000,
      category: 'Makanan',
    });

    const secondReply = await service.routeMessage('user-123', '25rb');
    expect(secondReply).toContain('Pengeluaran Berhasil Dicatat');
    expect(mockExpenseService.create).toHaveBeenCalled();
  });

  it('should cancel the pending action if user says cancel', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-123', plan: 'pro' });
    mockAIService.classifyIntent.mockResolvedValue({
      intent: 'CREATE_REMINDER',
      confidence: 0.9,
      extracted: { title: 'rapat' },
    });

    await service.routeMessage('user-123', 'buat reminder rapat');

    // Cancel action
    const reply = await service.routeMessage('user-123', 'batal aja');
    expect(reply).toContain('dibatalkan');
  });
});
