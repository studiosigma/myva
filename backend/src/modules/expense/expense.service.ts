import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { Expense } from '@prisma/client';

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateExpenseDto): Promise<Expense> {
    this.logger.log(`Recording expense of ${dto.amount} for user ${userId}`);
    return this.prisma.expense.create({
      data: {
        userId,
        amount: dto.amount,
        description: dto.description,
        category: dto.category || 'Lainnya',
      },
    });
  }

  async findAll(userId: string): Promise<Expense[]> {
    return this.prisma.expense.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMonthlyStats(userId: string): Promise<{ category: string; total: number }[]> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        createdAt: {
          gte: startOfMonth,
        },
      },
    });

    const categoryMap: Record<string, number> = {};
    for (const exp of expenses) {
      const cat = exp.category || 'Lainnya';
      categoryMap[cat] = (categoryMap[cat] || 0) + exp.amount;
    }

    return Object.entries(categoryMap).map(([category, total]) => ({
      category,
      total,
    }));
  }

  async getMonthlyTotal(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const aggregate = await this.prisma.expense.aggregate({
      where: {
        userId,
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    return aggregate._sum.amount || 0;
  }

  async getMonthlyCategoryTotal(userId: string, category: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const aggregate = await this.prisma.expense.aggregate({
      where: {
        userId,
        category: {
          equals: category,
          mode: 'insensitive',
        },
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    return aggregate._sum.amount || 0;
  }

  async checkBudgetStatus(userId: string): Promise<{
    hasBudget: boolean;
    monthlyBudget: number;
    monthlyTotal: number;
    percentage: number;
    status: 'safe' | 'warning' | 'exceeded';
    remaining: number;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.monthlyBudget) {
      return {
        hasBudget: false,
        monthlyBudget: 0,
        monthlyTotal: 0,
        percentage: 0,
        status: 'safe',
        remaining: 0,
      };
    }

    const monthlyTotal = await this.getMonthlyTotal(userId);
    const percentage = Math.round((monthlyTotal / user.monthlyBudget) * 100);
    const remaining = user.monthlyBudget - monthlyTotal;

    let status: 'safe' | 'warning' | 'exceeded' = 'safe';
    if (percentage >= 100) {
      status = 'exceeded';
    } else if (percentage >= 75) {
      status = 'warning';
    }

    return {
      hasBudget: true,
      monthlyBudget: user.monthlyBudget,
      monthlyTotal,
      percentage,
      status,
      remaining,
    };
  }
}
