use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use tiny_http::{Request, Response, Server};

fn connection() -> (Server, TcpStream) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    client.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
    (server, client)
}

fn request(server: &Server) -> Request {
    server.recv_timeout(Duration::from_secs(2)).unwrap().expect("request headers should be dispatched without waiting for body bytes")
}

#[test]
fn abort_prevents_dispatch_of_already_buffered_followup_request() {
    let (server, mut client) = connection();
    client.write_all(b"GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nPUT /never HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}").unwrap();
    let req = request(&server);
    assert_eq!(req.url(), "/first");
    req.abort();
    assert!(server.recv_timeout(Duration::from_millis(80)).unwrap().is_none());
}

#[test]
fn unsupported_version_is_rejected_without_waiting_on_its_own_writer() {
    let (server, mut client) = connection();
    client.write_all(b"GET / HTTP/2.0\r\nHost: localhost\r\nContent-Length: 1000000000\r\n\r\n").unwrap();
    let mut response = String::new();
    client.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 505"));
    assert!(server.recv_timeout(Duration::from_millis(30)).unwrap().is_none());
}

#[test]
fn small_and_expect_continue_bodies_are_dispatched_before_upload() {
    for expect in ["", "Expect: 100-continue\r\n"] {
        let (server, mut client) = connection();
        write!(client, "PUT /config HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n{expect}\r\n").unwrap();
        let req = request(&server);
        assert_eq!(req.body_length(), Some(10));
        req.abort();
    }
}

#[test]
fn fixed_and_chunked_stalls_reach_deadline_and_drop_promptly() {
    for (framing, partial) in [
        ("Content-Length: 262144\r\n", "{"),
        ("Transfer-Encoding: chunked\r\n", "4\r\n{"),
        ("Transfer-Encoding: chunked\r\n", "2\r\n{}\r\n"),
    ] {
        let (server, mut client) = connection();
        write!(client, "PUT /config HTTP/1.1\r\nHost: localhost\r\n{framing}\r\n{partial}").unwrap();
        let mut req = request(&server);
        req.set_body_deadline(Duration::from_millis(80));
        let start = Instant::now();
        let error = req.as_reader().read_to_end(&mut Vec::new()).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(1));
        let drop_start = Instant::now();
        req.abort();
        assert!(drop_start.elapsed() < Duration::from_millis(100));
    }
}

#[test]
fn trickling_bytes_do_not_extend_absolute_deadline() {
    let (server, mut client) = connection();
    client.write_all(b"PUT /config HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10000\r\n\r\n").unwrap();
    let mut req = request(&server);
    req.set_body_deadline(Duration::from_millis(130));
    let trickle = thread::spawn(move || {
        for _ in 0..40 {
            if client.write_all(b"x").is_err() { break; }
            thread::sleep(Duration::from_millis(20));
        }
    });
    let start = Instant::now();
    assert_eq!(req.as_reader().read_to_end(&mut Vec::new()).unwrap_err().kind(), ErrorKind::TimedOut);
    assert!(start.elapsed() < Duration::from_millis(600));
    req.abort();
    trickle.join().unwrap();
}

#[test]
fn abort_does_not_allocate_or_drain_declared_huge_body() {
    let (server, mut client) = connection();
    write!(client, "GET /unknown HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n", usize::MAX / 2).unwrap();
    let req = request(&server);
    let start = Instant::now();
    req.abort();
    assert!(start.elapsed() < Duration::from_millis(100));
    let mut byte = [0];
    match client.read(&mut byte) {
        Ok(0) => (),
        Err(e) if matches!(e.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted) => (),
        other => panic!("aborted socket remained open: {:?}", other),
    }
}

#[test]
fn rejecting_an_unread_body_cannot_drain_forever() {
    let (server, mut client) = connection();
    client.write_all(b"PUT /config HTTP/1.1\r\nHost: localhost\r\nContent-Length: 20000\r\n\r\n").unwrap();
    let mut req = request(&server);
    req.set_body_deadline(Duration::from_millis(80));
    let start = Instant::now();
    req.respond(Response::empty(401)).unwrap();
    assert!(start.elapsed() < Duration::from_secs(1));
}

#[test]
fn premature_fixed_length_eof_is_not_a_successful_body() {
    let (server, mut client) = connection();
    client.write_all(b"PUT /config HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\n{}").unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut req = request(&server);
    assert_eq!(req.as_reader().read_to_end(&mut Vec::new()).unwrap_err().kind(), ErrorKind::UnexpectedEof);
    req.abort();
}

#[test]
fn completed_request_deadline_does_not_affect_next_keepalive_body() {
    let (server, mut client) = connection();
    client.write_all(b"PUT /first HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}PUT /second HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n").unwrap();
    let mut first = request(&server);
    let mut body = String::new();
    first.as_reader().read_to_string(&mut body).unwrap();
    assert_eq!(body, "{}");
    first.set_body_deadline(Duration::ZERO);
    first.respond(Response::empty(204)).unwrap();
    let mut second = request(&server);
    second.set_body_deadline(Duration::from_secs(1));
    client.write_all(b"{}").unwrap();
    body.clear();
    second.as_reader().read_to_string(&mut body).unwrap();
    assert_eq!(body, "{}");
    second.respond(Response::empty(204)).unwrap();
}

#[test]
fn pipelined_uploads_and_reads_wait_outside_application_workers() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let addr = server.server_addr().to_ip().unwrap();
    let mut clients = Vec::new();
    let mut streams = Vec::new();
    for i in 0..4 {
        let mut client = TcpStream::connect(addr).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        write!(client, "GET /events/{i} HTTP/1.1\r\nHost: localhost\r\n\r\nPUT /config HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 10\r\n\r\n").unwrap();
        let req = request(&server);
        assert_eq!(req.url(), format!("/events/{i}"));
        let mut stream = req.into_writer();
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n").unwrap();
        stream.flush().unwrap();
        streams.push(stream);
        clients.push(client);
    }
    assert!(server.recv_timeout(Duration::from_millis(50)).unwrap().is_none());
    let mut healthy = TcpStream::connect(addr).unwrap();
    healthy.write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
    let req = request(&server);
    assert_eq!(req.url(), "/health");
    req.respond(Response::empty(200)).unwrap();
    // Completing the first response permits its queued upload; aborting it does not
    // close unrelated streaming connections or let another queued request jump ahead.
    drop(streams.remove(0));
    let req = request(&server);
    assert_eq!(req.url(), "/config");
    req.abort();
    for stream in &mut streams {
        stream.write_all(b": alive\n\n").unwrap();
        stream.flush().unwrap();
    }
    drop(clients);
    drop(streams);
}

#[test]
fn next_header_idle_timeout_does_not_close_streaming_response() {
    let (server, mut client) = connection();
    client.set_read_timeout(Some(Duration::from_secs(13))).unwrap();
    client.write_all(b"GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
    let req = request(&server);
    let mut writer = req.into_writer();
    writer.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n").unwrap();
    writer.flush().unwrap();
    let reader = thread::spawn(move || {
        let mut all = Vec::new();
        let mut block = [0; 1024];
        while !all.ends_with(b": alive\n\n") {
            let n = client.read(&mut block).unwrap();
            assert!(n > 0, "header idle timeout closed an active response");
            all.extend_from_slice(&block[..n]);
        }
    });
    thread::sleep(Duration::from_millis(11000));
    writer.write_all(b": alive\n\n").unwrap();
    writer.flush().unwrap();
    reader.join().unwrap();
}
