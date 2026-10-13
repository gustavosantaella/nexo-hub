import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Role } from '../../../common/constants/enums';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  /** Se ejecuta tras validar la firma; devuelve el usuario en request.user. */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    try {
      const user = await this.usersService.findOne(payload.sub);
      if (!user.active) {
        throw new UnauthorizedException('El usuario esta inactivo');
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as Role,
      };
    } catch {
      throw new UnauthorizedException('Sesion invalida o expirada');
    }
  }
}
