import { PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto';

/** No permite reasignar el efecto en caja; solo datos del gasto. */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
