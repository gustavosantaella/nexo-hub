import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { MediaService, type UploadedImage } from './media.service';

describe('MediaService', () => {
  let http: HttpTestingController;
  let service: MediaService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MediaService);
  });

  afterEach(() => http.verify());

  it('sube el archivo como multipart y devuelve la URL local', () => {
    const file = new File(['imagen'], 'foto.png', { type: 'image/png' });
    let response: UploadedImage | undefined;

    service.upload(file, 'products', 'foto.png').subscribe((value) => {
      response = value;
    });

    const request = http.expectOne(`${environment.apiUrl}/media/upload`);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('folder')).toBe('products');
    const uploaded = body.get('file') as File;
    expect(uploaded.name).toBe('foto.png');
    expect(uploaded.type).toBe('image/png');

    request.flush({ url: '/media/J-1/products/foto.png', bytes: 6 });

    expect(response).toEqual({ url: '/media/J-1/products/foto.png', bytes: 6 });
  });
});
