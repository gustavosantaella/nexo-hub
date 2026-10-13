import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '../../common/constants/enums';
import type { JwtPayload } from '../../common/interfaces/authenticated-user.interface';
import { comparePassword } from '../../common/utils/password.util';
import { UsersService, type PublicUser } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const passwordMatches = await comparePassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    await this.usersService.markLogin(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
    };

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: safeUser as PublicUser,
    };
  }

  profile(userId: string): Promise<PublicUser> {
    return this.usersService.findOne(userId);
  }
}
