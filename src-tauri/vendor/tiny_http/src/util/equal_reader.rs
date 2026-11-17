use std::io::Read;
use std::io::Result as IoResult;
use std::sync::mpsc::channel;
use std::sync::mpsc::{Receiver, Sender};

/// A `Reader` that reads exactly the number of bytes from a sub-reader.
///
/// If the limit is reached, it returns EOF. If the limit is not reached
/// when the destructor is called, the remaining bytes will be read and
/// thrown away.
pub struct EqualReader<R>
where
    R: Read,
{
    reader: R,
    size: usize,
    last_read_signal: Sender<IoResult<()>>,
}

impl<R> EqualReader<R>
where
    R: Read,
{
    pub fn new(reader: R, size: usize) -> (EqualReader<R>, Receiver<IoResult<()>>) {
        let (tx, rx) = channel();

        let r = EqualReader {
            reader,
            size,
            last_read_signal: tx,
        };

        (r, rx)
    }
}

impl<R> Read for EqualReader<R>
where
    R: Read,
{
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        if self.size == 0 || buf.is_empty() {
            return Ok(0);
        }

        let buf = if buf.len() < self.size {
            buf
        } else {
            &mut buf[..self.size]
        };

        match self.reader.read(buf) {
            Ok(0) => {
                self.size = 0;
                Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "incomplete request body"))
            }
            Ok(len) => {
                self.size -= len;
                Ok(len)
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => Err(e),
            err @ Err(_) => { self.size = 0; err },
        }
    }
}

impl<R> Drop for EqualReader<R>
where
    R: Read,
{
    fn drop(&mut self) {
        let mut remaining_to_read = self.size;
        let mut buf = [0; 8192];

        while remaining_to_read > 0 {
            let len = remaining_to_read.min(buf.len());
            match self.reader.read(&mut buf[..len]) {
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    self.last_read_signal.send(Err(e)).ok();
                    break;
                }
                Ok(0) => {
                    self.last_read_signal.send(Ok(())).ok();
                    break;
                }
                Ok(other) => {
                    remaining_to_read -= other;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::EqualReader;
    use std::io::Read;

    #[test]
    fn interrupted_body_read_preserves_remaining_length() {
        struct OnceInterrupted(bool, std::io::Cursor<Vec<u8>>);
        impl Read for OnceInterrupted {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                if !self.0 { self.0 = true; return Err(std::io::ErrorKind::Interrupted.into()); }
                self.1.read(out)
            }
        }
        let (mut reader, _) = EqualReader::new(OnceInterrupted(false, std::io::Cursor::new(b"valid".to_vec())), 5);
        let mut body = Vec::new();
        reader.read_to_end(&mut body).unwrap();
        assert_eq!(body, b"valid");
    }

    #[test]
    fn drain_buffer_is_bounded_and_errors_are_not_retried_on_drop() {
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        struct FailingReader(Arc<AtomicUsize>);
        impl Read for FailingReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                assert!(buf.len() <= 8192);
                self.0.fetch_add(1, Ordering::Relaxed);
                Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "stalled"))
            }
        }
        let reads = Arc::new(AtomicUsize::new(0));
        let (reader, _) = EqualReader::new(FailingReader(reads.clone()), usize::MAX / 2);
        drop(reader);
        assert_eq!(reads.load(Ordering::Relaxed), 1);
        let (mut reader, _) = EqualReader::new(FailingReader(reads.clone()), 1000000);
        assert!(reader.read(&mut [0; 1]).is_err());
        drop(reader);
        assert_eq!(reads.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn test_limit() {
        use std::io::Cursor;

        let mut org_reader = Cursor::new("hello world".to_string().into_bytes());

        {
            let (mut equal_reader, _) = EqualReader::new(org_reader.by_ref(), 5);

            let mut string = String::new();
            equal_reader.read_to_string(&mut string).unwrap();
            assert_eq!(string, "hello");
        }

        let mut string = String::new();
        org_reader.read_to_string(&mut string).unwrap();
        assert_eq!(string, " world");
    }

    #[test]
    fn test_not_enough() {
        use std::io::Cursor;

        let mut org_reader = Cursor::new("hello world".to_string().into_bytes());

        {
            let (mut equal_reader, _) = EqualReader::new(org_reader.by_ref(), 5);

            let mut vec = [0];
            equal_reader.read_exact(&mut vec).unwrap();
            assert_eq!(vec[0], b'h');
        }

        let mut string = String::new();
        org_reader.read_to_string(&mut string).unwrap();
        assert_eq!(string, " world");
    }
}
