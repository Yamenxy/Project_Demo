import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [ContentController, AccessController],
  providers: [ContentService, AccessService],
  exports: [ContentService, AccessService],
})
export class ContentModule {}
